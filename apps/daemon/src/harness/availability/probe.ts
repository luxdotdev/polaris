/**
 * Probes one Harness on this Host without side effects: its binary's
 * `--version`, then its own sign-in status command. Polaris never reads the
 * credentials (ADR 0001) and never imports a driver here (ENG-196).
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  HarnessAvailability,
  type HarnessEntry,
  type HarnessStatus,
  type KnownHarnessKind,
} from "@polaris/protocol";
import { Effect, Option, Schema } from "effect";

/** The environment a probe resolves binaries and homes from (the Daemon's by default). */
export type ProbeEnv = Readonly<Record<string, string | undefined>>;

export interface RunResult {
  /** Null when the command couldn't start or timed out. */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface SignInState {
  readonly status: Extract<HarnessStatus, "ready" | "needs-sign-in" | "unknown">;
  readonly detail: string | null;
}

interface Prober {
  /** Overrides the binary on PATH (launchd / systemd PATHs often lack nvm or Homebrew). */
  readonly binaryEnv: string;
  readonly binary: string;
  /** Variables set on every probe command, on top of `env`. */
  readonly probeEnv: (env: ProbeEnv) => ProbeEnv;
  readonly signIn: (path: string, env: ProbeEnv) => Effect.Effect<SignInState>;
}

const PROBE_TIMEOUT_MS = 5_000;

const home = (env: ProbeEnv): string => env.HOME || homedir();

const firstLine = (text: string): string | null => text.trim().split("\n")[0]?.trim() || null;

/** Runs one probe command in the user's home directory; never fails. */
export const runProbe = (argv: ReadonlyArray<string>, env: ProbeEnv): Effect.Effect<RunResult> =>
  Effect.promise(async (): Promise<RunResult> => {
    try {
      const proc = Bun.spawn([...argv], {
        cwd: home(env),
        env: { ...env },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: PROBE_TIMEOUT_MS,
      });

      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      return { exitCode: proc.signalCode === null ? code : null, stdout, stderr };
    } catch (cause) {
      return { exitCode: null, stdout: "", stderr: String(cause) };
    }
  });

/** `2.1.283 (Claude Code)`, `codex-cli 0.158.0` → the version. */
export const parseVersion = (text: string): string | null =>
  text.match(/(\d+\.\d+\.\d+[^\s)]*)/)?.[1] ?? null;

const ClaudeAuthStatus = Schema.fromJsonString(Schema.Struct({ loggedIn: Schema.Boolean }));

const decodeClaudeAuth = Schema.decodeUnknownOption(ClaudeAuthStatus);

/**
 * Claude Code: `claude auth status --json`. On a Host where Claude Code has
 * never run it creates `~/.claude.json`, so there it isn't run at all.
 */
const claude: Prober = {
  binaryEnv: "POLARIS_CLAUDE",
  binary: "claude",
  probeEnv: () => ({ DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }),
  signIn: (path, env) =>
    Effect.gen(function* () {
      const config = env.CLAUDE_CONFIG_DIR
        ? join(env.CLAUDE_CONFIG_DIR, ".claude.json")
        : join(home(env), ".claude.json");

      if (!existsSync(config))
        return { status: "needs-sign-in", detail: "Claude Code hasn't been run on this host yet" };
      const result = yield* runProbe([path, "auth", "status", "--json"], env);

      return Option.match(decodeClaudeAuth(result.stdout), {
        onNone: (): SignInState => ({
          status: "unknown",
          detail: firstLine(result.stderr) ?? "`claude auth status` gave no answer",
        }),
        onSome: ({ loggedIn }): SignInState =>
          loggedIn
            ? { status: "ready", detail: null }
            : { status: "needs-sign-in", detail: "not signed in" },
      });
    }),
};

const codexHome = (env: ProbeEnv): string => env.CODEX_HOME || join(home(env), ".codex");

/**
 * Codex: `codex login status` (exit 0 signed in, "Not logged in" otherwise).
 * `CODEX_HOME` is always passed explicitly: Codex then never creates it.
 */
const codex: Prober = {
  binaryEnv: "POLARIS_CODEX",
  binary: "codex",
  probeEnv: (env) => ({ CODEX_HOME: codexHome(env) }),
  signIn: (path, env) =>
    Effect.gen(function* () {
      if (!existsSync(codexHome(env)))
        return { status: "needs-sign-in", detail: "Codex hasn't been run on this host yet" };
      const result = yield* runProbe([path, "login", "status"], env);

      if (result.exitCode === 0) return { status: "ready", detail: null };

      if (/not logged in/i.test(`${result.stderr}\n${result.stdout}`))
        return { status: "needs-sign-in", detail: "not signed in" };

      return {
        status: "unknown",
        detail: firstLine(result.stderr) ?? "`codex login status` gave no answer",
      };
    }),
};

const PROBERS: Record<KnownHarnessKind, Prober> = { claude, codex };

/** The binary a Harness runs as on this Host, or null when it isn't installed. */
export const harnessBinary = (kind: KnownHarnessKind, env: ProbeEnv): string | null => {
  const prober = PROBERS[kind];
  const override = env[prober.binaryEnv];

  if (override) return existsSync(override) ? override : null;

  return Bun.which(prober.binary, { PATH: env.PATH ?? "" });
};

const availability = (
  entry: HarnessEntry<KnownHarnessKind>,
  fields: Pick<HarnessAvailability, "status" | "version" | "detail" | "signInArgv">
) => new HarnessAvailability({ harness: entry.kind, minVersion: entry.minVersion, ...fields });

/** Not installed → outdated → the Harness's own sign-in status. */
export const probeHarness = Effect.fn("harness.availability.probe")(function* (
  entry: HarnessEntry<KnownHarnessKind>,
  env: ProbeEnv
) {
  const prober = PROBERS[entry.kind];
  const path = harnessBinary(entry.kind, env);

  if (path === null)
    return availability(entry, {
      status: "not-installed",
      version: null,
      detail: `${prober.binary} was not found on PATH`,
      signInArgv: null,
    });
  const probeEnv = { ...env, ...prober.probeEnv(env) };
  const signInArgv = [path, ...entry.setup.signInCommand.slice(1)];
  const run = yield* runProbe([path, "--version"], probeEnv);

  if (run.exitCode !== 0)
    return availability(entry, {
      status: "unknown",
      version: null,
      detail: firstLine(run.stderr) ?? `\`${prober.binary} --version\` failed`,
      signInArgv,
    });
  const version = parseVersion(run.stdout);

  if (version !== null && Bun.semver.order(version, entry.minVersion) < 0)
    return availability(entry, {
      status: "outdated",
      version,
      detail: `${entry.name} ${version} is older than ${entry.minVersion}`,
      signInArgv,
    });
  const signIn = yield* prober.signIn(path, probeEnv);

  return availability(entry, { ...signIn, version, signInArgv });
});

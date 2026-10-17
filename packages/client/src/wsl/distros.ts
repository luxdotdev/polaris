/**
 * The WSL distros on this Windows machine, from `wsl.exe --list --verbose`.
 * Parsed by columns from the right (state, version), so a localized header or
 * state word still yields the name; the first line is always the header.
 * Verified against WSL 2.7 in English; localized output only through the fake.
 */
import { Data, Effect, Schema } from "effect";
import { type ChildProcessApi, childProcesses } from "../process/index.ts";
import { decodeWslOutput, wslEnv } from "./output.ts";

export const WslDistroState = Schema.Literals(["running", "stopped", "unknown"]);

export type WslDistroState = typeof WslDistroState.Type;

export class WslDistro extends Schema.Class<WslDistro>("WslDistro")({
  name: Schema.String,
  /** 1 or 2; only WSL 2 distros can be Hosts (a WSL 1 distro has no real kernel for Bun). */
  version: Schema.Number,
  state: WslDistroState,
  isDefault: Schema.Boolean,
}) {}

/** What asking `wsl.exe` for its distros found. */
export type WslDiscovery = Data.TaggedEnum<{
  Distros: { readonly distros: ReadonlyArray<WslDistro> };
  /** WSL answers but has no distro: "wsl --install -d Ubuntu" is the user's step. */
  NoDistros: Record<never, never>;
  /** No `wsl.exe`, or the stub that says WSL is not installed. */
  NotInstalled: { readonly detail: string };
  /** Not Windows: WSL never exists here. */
  Unsupported: Record<never, never>;
  Failed: { readonly detail: string };
}>;

export const WslDiscovery = Data.taggedEnum<WslDiscovery>();

/** Docker Desktop's helper distros are not Hosts; the user never sees them. */
export const HIDDEN_DISTROS: ReadonlySet<string> = new Set([
  "docker-desktop",
  "docker-desktop-data",
]);

const STATES: ReadonlyArray<readonly [RegExp, WslDistroState]> = [
  [/^(running|wird ausgeführt|en cours|en ejecución)$/i, "running"],
  [/^(stopped|beendet|arrêté|detenido)$/i, "stopped"],
];

const stateOf = (word: string): WslDistroState =>
  STATES.find(([pattern]) => pattern.test(word))?.[1] ?? "unknown";

const parseLine = (line: string): WslDistro | null => {
  const isDefault = line.startsWith("*");

  const columns = line
    .replace(/^\*/, "")
    .trim()
    .split(/\s{2,}/);

  if (columns.length < 3) return null;
  const version = Number(columns.at(-1));
  const state = columns.at(-2) ?? "";
  const name = columns.slice(0, -2).join("  ");

  if (!Number.isInteger(version) || name === "") return null;

  return new WslDistro({ name, version, state: stateOf(state), isDefault });
};

/** Parses the text of `wsl.exe -l -v`; the header line is skipped, blank lines ignored. */
export const parseDistroList = (text: string): ReadonlyArray<WslDistro> =>
  text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .slice(1)
    .flatMap((line) => {
      const distro = parseLine(line);

      return distro === null ? [] : [distro];
    });

/**
 * wsl.exe's messages that mean WSL can't run here. Its text is localized; the error codes after
 * "Error code:" are not, so they come first. `wsl.exe --install` alone is no sign: every
 * language's "no installed distributions" message names it too.
 */
export const NOT_INSTALLED_PATTERN =
  /WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED|WSL_E_VIRTUAL_MACHINE_PLATFORM_REQUIRED|HCS_E_HYPERV_NOT_INSTALLED|is not installed|not enabled|Press any key to install/i;

/** The registry keys of WSL's service: `WSLService` (WSL from the Store) or `LxssManager` (inbox WSL). */
export const WSL_SERVICE_KEYS: ReadonlyArray<string> = [
  "HKLM\\SYSTEM\\CurrentControlSet\\Services\\WSLService",
  "HKLM\\SYSTEM\\CurrentControlSet\\Services\\LxssManager",
];

export interface DiscoverOptions {
  /** `wsl.exe` by default; tests point this at the fake. */
  readonly wslBinary?: string;
  readonly env?: Record<string, string | undefined>;
  /** `process.platform` by default; off Windows the answer is `Unsupported` without spawning. */
  readonly platform?: NodeJS.Platform | undefined;
  readonly timeoutMs?: number;
  /** Starts `wsl.exe` and `reg.exe` (`ChildProcess`); tests script them. */
  readonly processes?: ChildProcessApi;
  /**
   * Asks the registry for WSL's service before running `wsl.exe`: without WSL, Windows' own
   * `wsl.exe` waits on "Press any key to install". On by default for the real `wsl.exe`.
   */
  readonly checkService?: boolean;
}

export const DEFAULT_WSL_BINARY = "wsl.exe";

interface RawResult {
  readonly code: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly spawnError: NodeJS.ErrnoException | null;
  /** Killed after `timeoutMs` without exiting. */
  readonly timedOut?: boolean;
}

const concat = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;

  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }

  return out;
};

type Run = (file: string, args: ReadonlyArray<string>) => Effect.Effect<RawResult>;

const runner =
  (env: Record<string, string | undefined>, timeoutMs: number, processes: ChildProcessApi): Run =>
  (file, args) =>
    Effect.callback<RawResult>((resume) => {
      const child = processes.spawn({ file, args, env: wslEnv(env) });

      const stdout: Array<Uint8Array> = [];
      const stderr: Array<Uint8Array> = [];
      let spawnError: NodeJS.ErrnoException | null = null;
      let timedOut = false;
      child.stdout?.on("data", (chunk: Uint8Array) => stdout.push(chunk));
      child.stderr?.on("data", (chunk: Uint8Array) => stderr.push(chunk));
      child.on("error", (error: NodeJS.ErrnoException) => (spawnError = error));
      child.on("close", (code) =>
        resume(
          Effect.succeed({
            code: timedOut ? null : code,
            stdout: concat(stdout),
            stderr: concat(stderr),
            spawnError,
            timedOut,
          })
        )
      );

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      return Effect.sync(() => {
        clearTimeout(timer);
        child.kill();
      });
    });

/** The names `wsl.exe --list --quiet` printed, one per line; it prints no header or message. */
export const parseQuietList = (text: string): ReadonlyArray<string> =>
  text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

const visibleNames = (quiet: RawResult): ReadonlyArray<string> =>
  parseQuietList(decodeWslOutput(quiet.stdout)).filter((name) => !HIDDEN_DISTROS.has(name));

/**
 * `--list --verbose` with no distro exits -1 with a localized message and no error code, but
 * `--list --quiet` exits 0 and prints nothing: that is how "no distros" reads in any language.
 */
const noDistrosQuietly = (quiet: RawResult | null): boolean =>
  quiet !== null &&
  quiet.spawnError === null &&
  quiet.code === 0 &&
  visibleNames(quiet).length === 0;

/**
 * Classifies a finished `wsl.exe --list --verbose`, and the `--list --quiet` asked after it
 * failed; pure, so tests cover every answer.
 */
export const discoveryOf = (result: RawResult, quiet: RawResult | null = null): WslDiscovery => {
  if (result.spawnError !== null) {
    return WslDiscovery.NotInstalled({
      detail: `${DEFAULT_WSL_BINARY}: ${result.spawnError.code ?? result.spawnError.message}`,
    });
  }

  const out = decodeWslOutput(result.stdout);
  const text = `${out}\n${decodeWslOutput(result.stderr)}`.replaceAll("\u0000", "").trim();

  if (result.code !== 0 && noDistrosQuietly(quiet)) return WslDiscovery.NoDistros();

  if (result.code !== 0 && NOT_INSTALLED_PATTERN.test(text)) {
    return WslDiscovery.NotInstalled({ detail: text.split(/\r?\n/)[0] ?? "" });
  }

  if (result.timedOut === true) {
    return WslDiscovery.Failed({ detail: text || "wsl.exe did not answer" });
  }

  if (result.code !== 0) {
    return WslDiscovery.Failed({ detail: text || `wsl.exe exited with ${result.code}` });
  }

  const distros = parseDistroList(out).filter((d) => !HIDDEN_DISTROS.has(d.name));

  return distros.length === 0 ? WslDiscovery.NoDistros() : WslDiscovery.Distros({ distros });
};

/** `reg.exe query`'s exit status says whether a key exists in any display language: 0 yes, 1 no. */
const serviceRegistered = (run: Run): Effect.Effect<boolean> =>
  Effect.forEach(WSL_SERVICE_KEYS, (key) => run("reg.exe", ["query", key, "/ve"])).pipe(
    // reg.exe that didn't run or answered oddly proves nothing: wsl.exe is asked as before.
    Effect.map((answers) =>
      answers.some((answer) => answer.spawnError !== null || answer.code !== 1)
    )
  );

/** Asks `wsl.exe` for the distros; never fails, every outcome is a `WslDiscovery`. */
export const discoverDistros = (options: DiscoverOptions = {}): Effect.Effect<WslDiscovery> => {
  if ((options.platform ?? process.platform) !== "win32") {
    return Effect.succeed(WslDiscovery.Unsupported());
  }

  const binary = options.wslBinary ?? DEFAULT_WSL_BINARY;

  const run = runner(
    options.env ?? process.env,
    options.timeoutMs ?? 15_000,
    options.processes ?? childProcesses
  );

  return Effect.gen(function* () {
    if (
      (options.checkService ?? options.wslBinary === undefined) &&
      !(yield* serviceRegistered(run))
    ) {
      return WslDiscovery.NotInstalled({ detail: "no WSL service is registered on this PC" });
    }

    const verbose = yield* run(binary, ["--list", "--verbose"]);

    const failedOwnWay =
      verbose.spawnError === null && verbose.code !== 0 && verbose.timedOut !== true;

    const quiet = failedOwnWay ? yield* run(binary, ["--list", "--quiet"]) : null;

    return discoveryOf(verbose, quiet);
  });
};

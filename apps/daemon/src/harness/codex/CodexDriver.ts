/**
 * The Codex Harness driver: drives the user's own unmodified `codex` binary
 * through `codex app-server`, one shared server per Host on a Unix socket.
 * Polaris never reads, stores or forwards Codex credentials; sign-in stays in
 * Codex's own `codex login` flow.
 */
import { join } from "node:path";
import { Effect, type Scope } from "effect";
import { polarisHome } from "../../paths.ts";
import type { HarnessDriver, HarnessProbe } from "../HarnessDriver.ts";
import { CodexLimitTracker } from "../limits/codex.ts";
import type { PlanLimitSink } from "../limits/PlanLimits.ts";
import { acquireAppServer } from "./AppServer.ts";
import { openSession } from "./CodexSession.ts";
import { codexError } from "./RpcConnection.ts";

export interface CodexDriverOptions {
  /** The `codex` binary; defaults to the one on PATH. */
  readonly codexPath?: string | null;
  /**
   * The shared app-server's socket; defaults to `~/.polaris/codex.sock`. Keep it
   * short: Unix socket paths are limited to ~104 bytes.
   */
  readonly socketPath?: string;
  /** Spawn the app-server when nothing is listening (default true). */
  readonly spawnAppServer?: boolean;
  /** Reported to Codex as `clientInfo.version`. */
  readonly clientVersion?: string;
  /** Receives the account's Plan Limits as Codex reports them. */
  readonly planLimits?: PlanLimitSink;
}

/** `codex --version` only: never starts a session, a server, MCP servers or a login. */
export const probeCodex = (codexPath: string | null): Effect.Effect<HarnessProbe> =>
  Effect.promise(async (): Promise<HarnessProbe> => {
    if (codexPath === null)
      return { available: false, version: null, detail: "codex was not found on PATH" };

    try {
      const proc = Bun.spawn([codexPath, "--version"], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 5_000,
      });

      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (code !== 0)
        return { available: false, version: null, detail: (err || out).trim() || `exit ${code}` };
      const version = out.trim().match(/(\d+\.\d+\.\d+\S*)/)?.[1] ?? null;

      return { available: true, version, detail: codexPath };
    } catch (cause) {
      return { available: false, version: null, detail: String(cause) };
    }
  });

/**
 * Builds the driver. The shared app-server it may spawn lives in the caller's
 * scope (normally the HarnessRegistry layer), so it stops with the Daemon.
 */
export const makeCodexDriver = (
  options: CodexDriverOptions = {}
): Effect.Effect<HarnessDriver, never, Scope.Scope> =>
  Effect.gen(function* () {
    const codexPath = options.codexPath === undefined ? Bun.which("codex") : options.codexPath;

    const appServer = yield* acquireAppServer({
      codexPath,
      socketPath: options.socketPath ?? join(polarisHome(), "codex.sock"),
      spawn: options.spawnAppServer ?? true,
    });

    const planLimits = options.planLimits
      ? { sink: options.planLimits, tracker: new CodexLimitTracker() }
      : null;

    return {
      kind: "codex",
      capabilities: { steer: true, liveCoAttach: true, switchModel: true },
      probe: probeCodex(codexPath),
      open: (openOptions) =>
        codexPath === null
          ? Effect.fail(codexError("codex was not found on PATH; install Codex to use it"))
          : openSession(
              {
                appServer,
                codexPath,
                clientVersion: options.clientVersion ?? "0.0.0",
                planLimits,
              },
              openOptions
            ),
    } satisfies HarnessDriver;
  });

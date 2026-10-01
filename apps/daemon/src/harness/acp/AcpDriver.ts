/**
 * The generic ACP Harness driver: drives the user's own, unmodified Harness
 * binary as an Agent Client Protocol agent on stdio. One agent process per
 * Harness serves all of its Agent Sessions on this Host; it starts with the
 * first session and stops when the last one closes. Polaris never calls
 * `authenticate` and never sees credentials: sign-in stays in the Harness.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { HARNESS_CATALOGUE, harnessEntry } from "@polaris/protocol";
import { Deferred, Effect, RcRef, type Scope } from "effect";
import { polarisHome } from "../../paths.ts";
import { probeHarness } from "../availability/probe.ts";
import { HarnessError, type HarnessDriver, type HarnessProbe } from "../HarnessDriver.ts";
import { AcpCommands } from "./commands.ts";
import { newSession, openSession } from "./AcpSession.ts";
import { type AgentConnection, spawnAgent } from "./AgentConnection.ts";
import type { AcpHarness } from "./harnesses.ts";
import { toModels } from "./models.ts";
import type * as P from "./protocol.ts";

export interface AcpDriverOptions {
  readonly harness: AcpHarness;
  /** The Harness binary, looked up each time the agent starts (it may be installed later). */
  readonly binaryPath: () => string | null;
  /** Reported to the agent as `clientInfo.version`. */
  readonly clientVersion?: string;
  /** Where Model listing opens its throwaway session; defaults to `~/.polaris/acp/<kind>`. */
  readonly listCwd?: string;
}

interface Agent {
  readonly conn: AgentConnection;
  readonly path: string;
}

/** Everything the availability probe says, as a driver probe: `--version`, never a session. */
const probeAcp = (harness: AcpHarness): Effect.Effect<HarnessProbe> => {
  const entry = HARNESS_CATALOGUE.find((known) => known.kind === harness.kind);

  if (entry === undefined)
    return Effect.succeed({
      available: false,
      version: null,
      detail: `${harness.kind} is not in the catalogue`,
    });

  return probeHarness(entry, process.env).pipe(
    Effect.map((report) => ({
      available: report.status !== "not-installed" && report.status !== "outdated",
      version: report.version,
      detail: report.detail,
    }))
  );
};

export const makeAcpDriver = (
  options: AcpDriverOptions
): Effect.Effect<HarnessDriver, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { harness } = options;
    const name = harnessEntry(harness.kind)?.name ?? harness.kind;
    const fail = (message: string) => new HarnessError({ harness: harness.kind, message });
    // Set right after `RcRef.make`; the agent's watcher only runs once one has started.
    let invalidate: Effect.Effect<void> = Effect.void;

    const agent = yield* RcRef.make({
      acquire: Effect.gen(function* () {
        const path = options.binaryPath();

        if (path === null)
          return yield* fail(`${harness.binary} was not found on PATH; install ${name} to use it`);

        const conn = yield* spawnAgent({
          harness: harness.kind,
          argv: [path, ...harness.acpArgs],
          clientVersion: options.clientVersion ?? "0.0.0",
        });

        // A crashed agent is replaced by the next session, not handed out again.
        yield* Deferred.await(conn.closed).pipe(Effect.andThen(invalidate), Effect.forkScoped);

        return { conn, path } satisfies Agent;
      }),
    });

    invalidate = RcRef.invalidate(agent);
    const commands = new AcpCommands();

    const listModels = Effect.scoped(
      Effect.gen(function* () {
        const { conn } = yield* RcRef.get(agent);
        const cwd = options.listCwd ?? join(polarisHome(), "acp", harness.kind);
        mkdirSync(cwd, { recursive: true });
        const session = yield* newSession(conn, harness, cwd);

        if (conn.initialize.agentCapabilities?.sessionCapabilities?.close != null)
          yield* conn
            .request("session/close", {
              sessionId: session.sessionId,
            } satisfies P.ClientParams["session/close"])
            .pipe(Effect.timeout("2 seconds"), Effect.ignore);

        return toModels(session.configOptions ?? []);
      })
    );

    return {
      kind: harness.kind,
      capabilities: { steer: false, liveCoAttach: false, switchModel: true },
      probe: probeAcp(harness),
      listModels,
      listCommands: (cwd) => Effect.sync(() => commands.list(cwd)),
      open: (openOptions) =>
        Effect.gen(function* () {
          const { conn, path } = yield* RcRef.get(agent);

          return yield* openSession({ harness, binaryPath: path, conn, commands }, openOptions);
        }),
    } satisfies HarnessDriver;
  });

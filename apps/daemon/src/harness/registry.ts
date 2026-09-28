/**
 * The Harness drivers this Daemon runs. The Codex driver owns the Host's shared
 * `codex app-server`, which lives as long as this layer's scope.
 *
 * Each driver's module is loaded on first use (`probe`, `open`), not at start:
 * the Claude Agent SDK and the Codex protocol schemas would otherwise sit in
 * every idle Daemon's memory. `kind` and `capabilities` are known up front
 * (the engine reads them without opening anything), and Claude's terminal
 * follow-along comes from the hook receiver, which does not need the SDK.
 *
 * Under launchd / systemd a user's PATH often lacks nvm or Homebrew bins, so
 * `POLARIS_CODEX` and `POLARIS_CLAUDE` can point at the binaries explicitly.
 */
import type { HarnessKind } from "@polaris/protocol";
import { Effect, Layer, Scope } from "effect";
import { HarnessRegistry, ServiceError } from "../services.ts";
import { ClaudeHookReceiver } from "./claude/hooks.ts";
import type { HarnessDriver } from "./HarnessDriver.ts";

const binary = (env: string, name: string): string | null =>
  process.env[env] || Bun.which(name) || null;

/** What each driver declares; checked against the loaded drivers in registry.test.ts. */
export const DRIVER_CAPABILITIES = {
  codex: { steer: true, liveCoAttach: true },
  claude: { steer: true, liveCoAttach: false },
  bench: { steer: true, liveCoAttach: true },
} as const satisfies Record<HarnessKind | "bench", HarnessDriver["capabilities"]>;

/**
 * A driver that loads the real one the first time it is probed or opened.
 * `extra` carries members that must not wait for the load (Claude's follow-along).
 */
export const lazyDriver = (
  kind: HarnessKind,
  capabilities: HarnessDriver["capabilities"],
  load: Effect.Effect<HarnessDriver>,
  extra: Pick<HarnessDriver, "terminalFollow"> = {}
): Effect.Effect<HarnessDriver> =>
  Effect.map(Effect.cached(load), (loaded) => ({
    kind,
    capabilities,
    ...extra,
    probe: Effect.flatMap(loaded, (driver) => driver.probe),
    open: (options) => Effect.flatMap(loaded, (driver) => driver.open(options)),
  }));

export const HarnessRegistryLive = Layer.effect(
  HarnessRegistry,
  Effect.gen(function* () {
    const hookReceiver = yield* ClaudeHookReceiver;
    // The app-server the Codex driver may start belongs to this layer, not to the first `open`.
    const scope = yield* Effect.scope;
    const codexPath = binary("POLARIS_CODEX", "codex");
    const claudePath = binary("POLARIS_CLAUDE", "claude");
    // Benchmarks only (packages/bench): a scripted Harness stands in for every kind.
    const bench = process.env.POLARIS_BENCH_HARNESS === "1";

    const benchDriver = (kind: HarnessKind) =>
      lazyDriver(
        kind,
        DRIVER_CAPABILITIES.bench,
        Effect.promise(() => import("./bench/BenchDriver.ts")).pipe(
          Effect.map(({ makeBenchDriver }) => makeBenchDriver(kind))
        )
      );

    const drivers: ReadonlyArray<HarnessDriver> = bench
      ? [yield* benchDriver("codex"), yield* benchDriver("claude")]
      : [
          yield* lazyDriver(
            "codex",
            DRIVER_CAPABILITIES.codex,
            Effect.promise(() => import("./codex/CodexDriver.ts")).pipe(
              Effect.flatMap(({ makeCodexDriver }) => makeCodexDriver({ codexPath })),
              Scope.provide(scope)
            )
          ),
          yield* lazyDriver(
            "claude",
            DRIVER_CAPABILITIES.claude,
            Effect.promise(() => import("./claude/ClaudeDriver.ts")).pipe(
              Effect.map(({ makeClaudeDriver }) =>
                makeClaudeDriver({ hookReceiver, claudePath: () => claudePath })
              )
            ),
            // While In Terminal, Polaris follows the TUI through its HTTP hooks (hooks.ts).
            { terminalFollow: { events: hookReceiver.events, release: hookReceiver.release } }
          ),
        ];

    const byKind = new Map<HarnessKind, HarnessDriver>(drivers.map((d) => [d.kind, d]));

    return HarnessRegistry.of({
      get: (kind) => {
        const driver = byKind.get(kind);

        return driver
          ? Effect.succeed(driver)
          : Effect.fail(new ServiceError({ service: "harness", message: `no ${kind} driver` }));
      },
      all: Effect.succeed(drivers),
    });
  })
).pipe(Layer.provide(ClaudeHookReceiver.layer));

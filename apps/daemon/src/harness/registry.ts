/**
 * The Harness drivers this Daemon runs. The Codex driver owns the Host's shared
 * `codex app-server`, which lives as long as this layer's scope.
 *
 * Under launchd / systemd a user's PATH often lacks nvm or Homebrew bins, so
 * `POLARIS_CODEX` and `POLARIS_CLAUDE` can point at the binaries explicitly.
 */
import type { HarnessKind } from "@polaris/protocol"
import { Effect, Layer } from "effect"
import { HarnessRegistry, ServiceError } from "../services.ts"
import { makeClaudeDriver } from "./claude/ClaudeDriver.ts"
import { ClaudeHookReceiver } from "./claude/hooks.ts"
import { makeCodexDriver } from "./codex/CodexDriver.ts"
import type { HarnessDriver } from "./HarnessDriver.ts"

const binary = (env: string, name: string): string | null =>
  process.env[env] || Bun.which(name) || null

export const HarnessRegistryLive = Layer.effect(
  HarnessRegistry,
  Effect.gen(function* () {
    const hookReceiver = yield* ClaudeHookReceiver
    const claudePath = binary("POLARIS_CLAUDE", "claude")
    const drivers: ReadonlyArray<HarnessDriver> = [
      yield* makeCodexDriver({ codexPath: binary("POLARIS_CODEX", "codex") }),
      makeClaudeDriver({ hookReceiver, claudePath: () => claudePath }),
    ]
    const byKind = new Map<HarnessKind, HarnessDriver>(drivers.map((d) => [d.kind, d]))
    return HarnessRegistry.of({
      get: (kind) => {
        const driver = byKind.get(kind)
        return driver
          ? Effect.succeed(driver)
          : Effect.fail(new ServiceError({ service: "harness", message: `no ${kind} driver` }))
      },
      all: Effect.succeed(drivers),
    })
  }),
).pipe(Layer.provide(ClaudeHookReceiver.layer))

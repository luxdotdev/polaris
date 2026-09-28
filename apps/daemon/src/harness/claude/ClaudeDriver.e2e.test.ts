/**
 * One real, tiny Turn against the installed `claude`, using its own sign-in.
 * Opt in with `POLARIS_E2E_CLAUDE=1 bun test ClaudeDriver.e2e`.
 */
import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SessionId, TurnId } from "@polaris/protocol"
import { Effect, Exit, Scope, Stream } from "effect"
import type { HarnessEvent } from "../HarnessDriver.ts"
import { makeClaudeDriver } from "./ClaudeDriver.ts"

const enabled = process.env.POLARIS_E2E_CLAUDE === "1"

describe.skipIf(!enabled)("Claude driver against the real claude", () => {
  test(
    "runs one Turn and hands over a resumable cursor",
    async () => {
      const driver = makeClaudeDriver()
      const probe = await Effect.runPromise(driver.probe)
      expect(probe.available).toBe(true)

      const cwd = await mkdtemp(join(tmpdir(), "polaris-e2e-claude-"))
      const scope = Effect.runSync(Scope.make())
      const session = await Effect.runPromise(
        driver
          .open({
            sessionId: "e2e" as SessionId,
            cwd,
            permissionMode: "supervised",
            model: "haiku",
            resumeCursor: null,
          })
          .pipe(Scope.provide(scope)),
      )
      const events: HarnessEvent[] = []
      const done = Effect.runPromise(
        Stream.runForEach(session.events, (e) => Effect.sync(() => events.push(e))),
      )
      await Effect.runPromise(
        session.sendTurn({
          turnId: "e2e-turn" as TurnId,
          prompt: "Reply with the single word ok and nothing else. Do not use any tools.",
          attachments: [],
        }),
      )
      for (let i = 0; i < 1200 && !events.some((e) => e._tag === "TurnEnded"); i++)
        await Bun.sleep(100)

      const ended = events.find((e) => e._tag === "TurnEnded")
      expect(ended).toMatchObject({ status: "completed" })
      const text = events
        .flatMap((e) =>
          e._tag === "ItemCompleted" && e.item._tag === "AssistantMessage" ? [e.item.text] : [],
        )
        .join("")
      expect(text.toLowerCase()).toContain("ok")
      const cursor = events.find((e) => e._tag === "CursorAssigned")
      expect(cursor).toBeDefined()
      const argv = await Effect.runPromise(session.terminalCommand)
      expect(argv.slice(0, 2)).toEqual(["claude", "--resume"])

      await Effect.runPromise(Scope.close(scope, Exit.void))
      await done
      expect(events.at(-1)).toEqual({ _tag: "Exited", error: null })
      console.log("e2e events:", events.map((e) => e._tag).join(" "), "|", text)
    },
    { timeout: 180_000 },
  )
})

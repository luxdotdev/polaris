/**
 * Runs one tiny real Turn against the installed `codex` (uses the user's own
 * Codex sign-in and quota). Opt in with:
 *
 *   POLARIS_E2E_CODEX=1 bun test apps/daemon/src/harness/codex/e2e.test.ts
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionId, TurnId } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import type { HarnessEvent } from "../HarnessDriver.ts";
import { defaultStateFile, stopAppServer } from "./AppServer.ts";
import { makeCodexDriver } from "./CodexDriver.ts";

const enabled = process.env.POLARIS_E2E_CODEX === "1";

test.skipIf(!enabled)(
  "a real Codex Turn: reply with the word ok",
  async () => {
    const repo = mkdtempSync(join(tmpdir(), "polaris-codex-e2e-"));
    // Short, so it fits the Unix socket path limit.
    const socketDir = mkdtempSync("/tmp/pcx-");
    await Bun.$`git init -q && git commit -q --allow-empty -m init`.cwd(repo);
    try {
      const program = Effect.gen(function* () {
        const driver = yield* makeCodexDriver({ socketPath: join(socketDir, "s.sock") });
        const probe = yield* driver.probe;
        expect(probe.available).toBe(true);

        const session = yield* driver.open({
          sessionId: SessionId.make("e2e"),
          cwd: repo,
          permissionMode: "supervised",
          model: null,
          resumeCursor: null,
        });
        const turnId = TurnId.make("turn-1");
        yield* session.sendTurn({
          turnId,
          prompt: "Reply with just the word ok. Do not run commands or edit files.",
          attachments: [],
        });
        const events = yield* session.events.pipe(
          Stream.takeUntil((e: HarnessEvent) => e._tag === "TurnEnded"),
          Stream.runCollect
        );
        const terminal = yield* session.terminalCommand;
        return { events: Array.from(events), terminal };
      });
      const { events, terminal } = await Effect.runPromise(Effect.scoped(program));

      const cursor = events.find((e) => e._tag === "CursorAssigned");
      expect(cursor).toBeDefined();
      const ended = events.find((e) => e._tag === "TurnEnded");
      expect(ended).toMatchObject({ turnId: "turn-1", status: "completed", error: null });
      const reply = events.flatMap((e) =>
        e._tag === "ItemCompleted" && e.item._tag === "AssistantMessage" ? [e.item.text] : []
      );
      expect(reply.join(" ").toLowerCase()).toContain("ok");
      expect(terminal.slice(1)).toEqual([
        "resume",
        cursor?._tag === "CursorAssigned" ? cursor.cursor : "",
        "--remote",
        `unix://${join(socketDir, "s.sock")}`,
      ]);
    } finally {
      // The app-server outlives its Daemon by design; this test owns this one.
      const socketPath = join(socketDir, "s.sock");
      await Effect.runPromise(
        stopAppServer({ stateFile: defaultStateFile(socketPath), socketPath })
      );
      rmSync(repo, { recursive: true, force: true });
      rmSync(socketDir, { recursive: true, force: true });
    }
  },
  180_000
);

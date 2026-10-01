import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { TurnId, TurnItem } from "@polaris/protocol";
import { Effect } from "effect";
import { makeCodexDriver } from "./CodexDriver.ts";
import { harnessCallOf } from "./slash.ts";
import { readFixture, replay } from "./testing/FakeAppServer.ts";
import { cleanup, ofTag, scripted, sessionWith, THREAD, turn } from "./testing/session.ts";

const withSession = sessionWith(makeCodexDriver);

afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

const send = (prompt: string) => ({
  turnId: TurnId.make("turn-1"),
  prompt,
  attachments: [],
  model: null,
  effort: null,
});

describe("Codex slash commands", () => {
  test("only /compact and /review are Codex calls", () => {
    expect(harnessCallOf("  /compact\n", "t")).toEqual({
      method: "thread/compact/start",
      params: { threadId: "t" },
    });
    expect(harnessCallOf("/review", "t")?.params).toMatchObject({
      target: { type: "uncommittedChanges" },
      delivery: "inline",
    });
    expect(harnessCallOf("/review focus on the parser", "t")?.params).toMatchObject({
      target: { type: "custom", instructions: "focus on the parser" },
    });

    for (const prompt of ["/compact now", "/reviewer", "please /compact", "/model"])
      expect(harnessCallOf(prompt, "t")).toBeNull();
  });

  test("/compact runs thread/compact/start and its Turn takes the Polaris TurnId", async () => {
    const handler = scripted((request, conn) => {
      if (request.method !== "thread/compact/start") return;
      conn.reply({});
      conn.notify("turn/started", { threadId: THREAD, turn: turn("c1") });
      conn.notify("turn/completed", { threadId: THREAD, turn: turn("c1", "completed") });
    });

    const { events, server } = await withSession(handler, ({ session, waitFor }) =>
      Effect.gen(function* () {
        yield* session.sendTurn(send("/compact"));
        yield* waitFor("TurnEnded");
      })
    );

    expect(server.requests("turn/start")).toHaveLength(0);
    expect(server.requests("thread/compact/start")[0]?.params).toEqual({ threadId: THREAD });
    const started = ofTag(events, "TurnStarted");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ turnId: "turn-1", prompt: "/compact" });
    expect(ofTag(events, "TurnEnded")[0]).toMatchObject({ turnId: "turn-1", status: "completed" });
  });

  test("/review runs review/start inline and binds its Turn from the reply", async () => {
    const handler = scripted((request, conn) => {
      if (request.method !== "review/start") return;
      conn.reply({ turn: turn("r1"), reviewThreadId: THREAD });
      conn.notify("turn/started", { threadId: THREAD, turn: turn("r1") });
      conn.notify("turn/completed", { threadId: THREAD, turn: turn("r1", "completed") });
    });

    const { events, server } = await withSession(handler, ({ session, waitFor }) =>
      Effect.gen(function* () {
        yield* session.sendTurn(send("/review the error paths"));
        yield* waitFor("TurnEnded");
      })
    );

    expect(server.requests("review/start")[0]?.params).toEqual({
      threadId: THREAD,
      delivery: "inline",
      target: { type: "custom", instructions: "the error paths" },
    });
    expect(ofTag(events, "TurnStarted")).toHaveLength(1);
    expect(ofTag(events, "TurnEnded")[0]).toMatchObject({ turnId: "turn-1", status: "completed" });
  });

  test("a refused /compact frees the session for the next Turn", async () => {
    const handler = scripted((request, conn) => {
      if (request.method === "thread/compact/start")
        return conn.replyError(-32600, "nothing to compact");

      if (request.method === "turn/start") conn.reply({ turn: turn("t2") });
    });

    const { result } = await withSession(handler, ({ session }) =>
      Effect.gen(function* () {
        const refused = yield* session.sendTurn(send("/compact")).pipe(Effect.flip);
        yield* session.sendTurn({ ...send("hello"), turnId: TurnId.make("turn-2") });

        return refused.message;
      })
    );

    expect(result).toContain("nothing to compact");
  });

  test("real traffic: a Turn, /compact, then /review of an uncommitted change", async () => {
    // Recorded from codex-cli 0.159.2 (gpt-6-luna, low) by scripts/e2e-codex-slash.ts; paths and account frames scrubbed.
    const frames = await readFixture(join(import.meta.dir, "fixtures/slash-turns.jsonl"));

    const turnN = (n: number, prompt: string) => ({
      ...send(prompt),
      turnId: TurnId.make(`turn-${n}`),
    });

    const { events, result } = await withSession(replay(frames), ({ session, waitFor }) =>
      Effect.gen(function* () {
        const ended = (n: number) => waitFor("TurnEnded", (e) => e.turnId === `turn-${n}`);

        yield* session.sendTurn(turnN(1, "Reply with just the word ok."));
        yield* ended(1);
        yield* session.sendTurn(turnN(2, "/compact"));
        yield* ended(2);
        yield* session.sendTurn(turnN(3, "/review"));
        yield* ended(3);

        // Codex runs a review under a second turn id; the session must still be free afterwards.
        return yield* session.sendTurn(turnN(4, "again")).pipe(Effect.flip);
      })
    );

    expect(result.message).toContain("fixture has no further turn/start");
    expect(ofTag(events, "TurnStarted").map((e) => String(e.turnId))).toEqual([
      "turn-1",
      "turn-2",
      "turn-3",
    ]);
    expect(ofTag(events, "TurnEnded").map((e) => `${e.turnId} ${e.status}`)).toEqual([
      "turn-1 completed",
      "turn-2 completed",
      "turn-3 completed",
    ]);

    const itemsOf = (turnId: string) =>
      ofTag(events, "ItemCompleted")
        .filter((e) => e.turnId === turnId)
        .map((e) => e.item);

    expect(itemsOf("turn-3").some(TurnItem.guards.CommandExecution)).toBe(true);
    expect(itemsOf("turn-3").filter(TurnItem.guards.AssistantMessage).at(-1)?.text).toContain(
      "hello, world"
    );
  });
});

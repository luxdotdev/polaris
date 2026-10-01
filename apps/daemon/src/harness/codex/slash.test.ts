import { afterEach, describe, expect, test } from "bun:test";
import { TurnId } from "@polaris/protocol";
import { Effect } from "effect";
import { makeCodexDriver } from "./CodexDriver.ts";
import { harnessCallOf } from "./slash.ts";
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
});

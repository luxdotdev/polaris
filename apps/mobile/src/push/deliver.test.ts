import { describe, expect, test } from "bun:test";
import { ApprovalDecision, Command, CommandId, RequestId, SessionId } from "@polaris/protocol";
import type { Answer } from "./answer.ts";
import { type AnswerHost, deliverAnswer, sendAnswer, unsentNotice } from "./deliver.ts";

const answer: Answer = {
  hostId: "h1",
  dispatch: {
    commandId: CommandId.make("push-answer:h1:r1"),
    command: Command.cases.RespondToApproval.make({
      sessionId: SessionId.make("s1"),
      requestId: RequestId.make("r1"),
      decision: ApprovalDecision.cases.Allow.make({ remember: false }),
    }),
  },
};

/** A Host that comes live after `liveAfterMs` (never when null) and records what it's sent. */
const fakeHost = (liveAfterMs: number | null) => {
  let live = false;
  const listeners = new Set<() => void>();
  const sent: Array<Answer["dispatch"]> = [];
  const retries: Array<number> = [];

  const host: AnswerHost = {
    hostId: "h1",
    isLive: () => live,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    dispatch: async (payload) => {
      if (!live) throw new Error("offline");
      sent.push(payload);
    },
    retryNow: () => {
      retries.push(Date.now());

      if (liveAfterMs === null) return;
      setTimeout(() => {
        live = true;

        for (const listener of listeners) listener();
      }, liveAfterMs);
    },
  };

  return { host, sent, retries, listeners };
};

describe("sending an answer after a wake", () => {
  test("waits for the Host to come live, then dispatches the answer once", async () => {
    const fake = fakeHost(30);

    expect(await sendAnswer([fake.host], answer, 1_000)).toBe("sent");
    expect(fake.sent).toEqual([answer.dispatch]);
    expect(fake.retries).toHaveLength(1);
    expect(fake.listeners.size).toBe(0);
  });

  test("a Host that doesn't come back in time is offline, and nothing is sent", async () => {
    const fake = fakeHost(null);

    expect(await sendAnswer([fake.host], answer, 50)).toBe("offline");
    expect(fake.sent).toEqual([]);
    expect(fake.listeners.size).toBe(0);
  });

  test("an answer for a Host this app doesn't know goes nowhere", async () => {
    expect(await sendAnswer([], answer, 50)).toBe("no-host");
  });
});

// RV2 / RX1-5: an action that launches the app arrives before the Keychain is read.
describe("answering from a cold start", () => {
  test("waits for the linked Hosts to load instead of finding none", async () => {
    const fake = fakeHost(10);
    let hosts: ReadonlyArray<AnswerHost> = [];
    const loaded = Promise.withResolvers<void>();

    const outcome = deliverAnswer(loaded.promise, () => hosts, answer, 1_000);
    await Bun.sleep(20);
    hosts = [fake.host];
    loaded.resolve();

    expect(await outcome).toBe("sent");
    expect(fake.sent).toEqual([answer.dispatch]);
  });

  test("an answer that couldn't be sent says so, naming the host", () => {
    expect(unsentNotice("sent", "Mac Studio")).toBeNull();
    expect(unsentNotice("offline", "Mac Studio")).toEqual({
      title: "Your answer wasn't sent",
      body: "Mac Studio didn't answer. Open Polaris to answer again.",
    });
  });
});

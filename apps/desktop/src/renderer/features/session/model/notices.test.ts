import { ApprovalRequest, RequestId, SessionId, TurnId } from "@polaris/protocol";
import { describe, expect, test } from "bun:test";
import { type NoticeInput, notices } from "./notices.ts";
import { type Outgoing, queuedOutgoing } from "./outbox.ts";

const request = new ApprovalRequest({
  id: RequestId.make("r1"),
  sessionId: SessionId.make("s1"),
  turnId: TurnId.make("t1"),
  kind: "command",
  title: "Run cargo build",
  detail: "cargo build --release",
  options: [],
  openedAt: "2026-10-28T00:00:00.000Z",
});

const quiet: NoticeInput = {
  approvals: [],
  working: false,
  outbox: [],
  contextShare: 0.17,
  contextDismissedAt: null,
  limited: false,
  resetsAt: null,
};

const kinds = (patch: Partial<NoticeInput>) => notices({ ...quiet, ...patch }).map((n) => n.kind);

describe("the composer's notice strip", () => {
  test("is empty when there is nothing to know", () => {
    expect(kinds({})).toEqual([]);
  });

  test("ranks approval lock, working, queued follow-ups, context nearly full, limited", () => {
    expect(
      kinds({
        limited: true,
        contextShare: 0.91,
        outbox: [queuedOutgoing("then open a pull request", [])],
        working: true,
        approvals: [request],
      })
    ).toEqual(["approval", "working", "queued", "context", "limited"]);
  });

  test("counts only follow-ups still waiting, not steers or ones already sent", () => {
    const sent: Outgoing = { ...queuedOutgoing("sent one", []), status: "sent" };
    const steer: Outgoing = { ...queuedOutgoing("a steer", []), kind: "steer" };
    const waiting = queuedOutgoing("waiting one", []);
    const [queued] = notices({ ...quiet, outbox: [sent, steer, waiting] });

    expect(queued).toEqual({ kind: "queued", entries: [waiting] });
  });

  test("context shows from 85% and, once closed, again only when it grows", () => {
    expect(kinds({ contextShare: 0.84 })).toEqual([]);
    expect(kinds({ contextShare: 0.85 })).toEqual(["context"]);
    expect(kinds({ contextShare: 0.9, contextDismissedAt: 0.9 })).toEqual([]);
    expect(kinds({ contextShare: 0.93, contextDismissedAt: 0.9 })).toEqual(["context"]);
    expect(kinds({ contextShare: null })).toEqual([]);
  });
});

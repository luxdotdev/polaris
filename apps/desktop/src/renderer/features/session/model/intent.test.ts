import { describe, expect, test } from "bun:test";
import {
  ApprovalRequest,
  AttachmentId,
  RequestId,
  type SessionState,
  SessionId,
  TurnId,
  type TurnStatus,
} from "@polaris/protocol";
import {
  archiveCommand,
  canQueue,
  composerMode,
  forkCommand,
  interruptCommand,
  openQuestion,
  placeholderFor,
  queuedCommand,
  renameCommand,
  submitCommand,
} from "./intent.ts";
import { Commands, Decisions } from "../../../commands.ts";

const sessionId = SessionId.make("s1");

const mode = (
  state: SessionState,
  lastTurn: TurnStatus | null,
  pendingApprovals = 0,
  canSteer = true,
  question: RequestId | null = null
) => composerMode({ state, lastTurn, pendingApprovals, question, canSteer });

describe("composer mode", () => {
  test("idle, dormant and failed sessions take a new Turn", () => {
    for (const state of ["idle", "dormant", "failed"] as const)
      expect(mode(state, "completed").kind).toBe("send");

    expect(mode("idle", null).kind).toBe("send");
  });

  test("a Turn in flight is steered with ↵; ⌘↵ queues a follow-up", () => {
    expect(mode("working", "working")).toEqual({ kind: "steer" });
    expect(placeholderFor(mode("working", "working"))).toBe(
      "Steer this turn · ⌘↵ to queue a follow-up"
    );
    expect(canQueue(mode("working", "working"))).toBe(true);
  });

  test("without steering, ↵ queues a follow-up for after the Turn", () => {
    expect(mode("working", "working", 0, false)).toEqual({ kind: "queue" });
    expect(placeholderFor(mode("working", "working", 0, false))).toBe(
      "Queue a follow-up for after this turn"
    );
    expect(canQueue(mode("idle", "completed"))).toBe(false);
  });

  test("an open question is answered in the composer's own words", () => {
    const question = RequestId.make("q1");

    expect(mode("needs-you", "working", 1, true, question)).toEqual({
      kind: "answer",
      requestId: question,
    });
    expect(placeholderFor({ kind: "answer", requestId: question })).toBe(
      "Or answer in your own words"
    );
    expect(
      submitCommand({ kind: "answer", requestId: question }, sessionId, {
        text: " keep 20px ",
        attachments: [],
      })
    ).toEqual(
      Commands.RespondToApproval({
        sessionId,
        requestId: question,
        decision: Decisions.Answer({ text: "keep 20px" }),
      })
    );
  });

  test("only questions open the composer; a pending command still blocks it", () => {
    const at = "2026-09-30T00:00:00.000Z";

    const request = (id: string, kind: "question" | "command") =>
      new ApprovalRequest({
        id: RequestId.make(id),
        sessionId,
        turnId: TurnId.make("t1"),
        kind,
        title: id,
        detail: null,
        options: [],
        openedAt: at,
      });

    expect(openQuestion([request("q", "question")])).toBe(RequestId.make("q"));
    expect(openQuestion([request("q", "question"), request("c", "command")])).toBeNull();
    expect(openQuestion([])).toBeNull();
  });

  test("a queued follow-up becomes the next Turn", () => {
    expect(queuedCommand(sessionId, { text: " next ", attachments: [] })).toEqual(
      Commands.SendTurn({ sessionId, prompt: "next", attachments: [] })
    );
    expect(queuedCommand(sessionId, { text: " ", attachments: [] })).toBeNull();
  });

  test("an open approval blocks until answered", () => {
    expect(mode("needs-you", "working", 1)).toEqual({
      kind: "blocked",
      reason: "Answer the request above to go on",
    });
  });

  test("Needs You after a restart (Interrupted, nothing pending) takes a new Turn", () => {
    expect(mode("needs-you", "interrupted", 0).kind).toBe("send");
  });

  test("archived, in terminal and starting sessions say why they can't send", () => {
    expect(placeholderFor(mode("archived", "completed"))).toBe(
      "Unarchive this session to send a turn"
    );
    expect(mode("in-terminal", "completed").kind).toBe("blocked");
    expect(mode("starting", null).kind).toBe("blocked");
  });
});

describe("composer commands", () => {
  const attachment = AttachmentId.make("a1");

  test("send becomes SendTurn with the trimmed prompt and attachments", () => {
    expect(
      submitCommand({ kind: "send" }, sessionId, { text: "  fix it \n", attachments: [attachment] })
    ).toEqual(Commands.SendTurn({ sessionId, prompt: "fix it", attachments: [attachment] }));
  });

  test("an attachment alone is a Turn; an empty draft is nothing", () => {
    expect(
      submitCommand({ kind: "send" }, sessionId, { text: " ", attachments: [attachment] })
    ).not.toBeNull();
    expect(submitCommand({ kind: "send" }, sessionId, { text: " ", attachments: [] })).toBeNull();
  });

  test("steer becomes Steer; blocked sends nothing", () => {
    expect(
      submitCommand({ kind: "steer" }, sessionId, { text: "use bun", attachments: [] })
    ).toEqual(Commands.Steer({ sessionId, text: "use bun" }));
    expect(
      submitCommand({ kind: "blocked", reason: "x" }, sessionId, { text: "a", attachments: [] })
    ).toBeNull();
  });

  test("esc interrupts only a Turn in flight", () => {
    expect(interruptCommand(sessionId, "working")).toEqual(Commands.Interrupt({ sessionId }));
    expect(interruptCommand(sessionId, "completed")).toBeNull();
  });

  test("rename trims and refuses empty titles", () => {
    expect(renameCommand(sessionId, " New ")).toMatchObject({ title: "New" });
    expect(renameCommand(sessionId, "  ")).toBeNull();
  });

  test("archive keeps merged branches; fork carries the Model", () => {
    expect(archiveCommand(sessionId, false)).toMatchObject({ deleteMergedBranch: false });
    expect(archiveCommand(sessionId, true)).toMatchObject({ deleteMergedBranch: true });

    const fork = {
      sessionId: SessionId.make("s2"),
      fromSessionId: sessionId,
      fromTurnId: TurnId.make("t1"),
      harness: "codex",
      model: "gpt-5.5",
      effort: "high",
    };

    expect(forkCommand(fork)).toEqual(Commands.ForkSession(fork));
  });
});

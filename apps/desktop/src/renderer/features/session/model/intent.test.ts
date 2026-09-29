import { describe, expect, test } from "bun:test";
import {
  AttachmentId,
  type SessionState,
  SessionId,
  TurnId,
  type TurnStatus,
} from "@polaris/protocol";
import {
  archiveCommand,
  composerMode,
  forkCommand,
  interruptCommand,
  placeholderFor,
  renameCommand,
  submitCommand,
} from "./intent.ts";
import { Commands } from "../../../commands.ts";

const sessionId = SessionId.make("s1");

const mode = (
  state: SessionState,
  lastTurn: TurnStatus | null,
  pendingApprovals = 0,
  canSteer = true
) => composerMode({ state, lastTurn, pendingApprovals, canSteer });

describe("composer mode", () => {
  test("idle, dormant and failed sessions take a new Turn", () => {
    for (const state of ["idle", "dormant", "failed"] as const)
      expect(mode(state, "completed").kind).toBe("send");

    expect(mode("idle", null).kind).toBe("send");
  });

  test("a Turn in flight is steered", () => {
    expect(mode("working", "working")).toEqual({ kind: "steer" });
    expect(placeholderFor(mode("working", "working"))).toBe("Steer this turn");
  });

  test("without steering, a Turn in flight blocks the composer", () => {
    expect(mode("working", "working", 0, false).kind).toBe("blocked");
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
    expect(archiveCommand(sessionId)).toMatchObject({ deleteMergedBranch: false });

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

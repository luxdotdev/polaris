import { describe, expect, test } from "bun:test";
import { TurnId, TurnItem } from "@polaris/protocol";
import { turnWith } from "../../../store/fixtures.testing.ts";
import type { TurnView } from "../../../store/sessionModel.ts";
import {
  MISSED_STEER,
  nextQueued,
  type Outgoing,
  queuedOutgoing,
  settleOutbox,
  steerOutgoing,
} from "./outbox.ts";

const turn = (
  index: number,
  steers: ReadonlyArray<string>,
  status: "working" | "completed" = "working"
): TurnView => ({
  turn: turnWith({ id: TurnId.make(`t${index}`), index, prompt: "go", status }),
  items: steers.map((text, n) => TurnItem.cases.UserMessage.make({ id: `u${n}`, text })),
  live: new Map(),
  subagents: [],
});

const sent = (entry: Outgoing): Outgoing => ({ ...entry, status: "sent" });

describe("outbox", () => {
  test("a steer stays until its Turn reports it, then drops out", () => {
    const turns = [turn(0, [])];
    const steer = sent(steerOutgoing(turns, "t0", " also lint "));
    const outbox = [steer];

    expect(steer).toMatchObject({ text: "also lint", baseline: 0 });
    expect(settleOutbox(outbox, turns)).toBe(outbox);
    expect(settleOutbox(outbox, [turn(0, ["also lint"])])).toEqual([]);
  });

  test("a steer sending (no answer yet) isn't matched", () => {
    const outbox = [steerOutgoing([turn(0, [])], "t0", "x")];

    expect(settleOutbox(outbox, [turn(0, ["x"])])).toBe(outbox);
  });

  test("steers already in the Turn don't count; the same text twice lands twice", () => {
    const before = [turn(0, ["again"])];
    const a = sent(steerOutgoing(before, "t0", "again"));
    const b = sent(steerOutgoing(before, "t0", "again"));

    expect(a.baseline).toBe(1);
    expect(settleOutbox([a, b], before)).toEqual([a, b]);
    expect(settleOutbox([a, b], [turn(0, ["again", "again"])])).toEqual([b]);
    expect(settleOutbox([a, b], [turn(0, ["again", "again", "again"])])).toEqual([]);
  });

  test("a steer whose Turn ended without it fails", () => {
    const steer = sent(steerOutgoing([turn(0, [])], "t0", "x"));

    expect(settleOutbox([steer], [turn(0, [], "completed")])).toEqual([
      { ...steer, status: "failed", error: MISSED_STEER },
    ]);
  });

  test("a follow-up drops out once its Turn starts, one sent at a time", () => {
    const first = queuedOutgoing("next", []);
    const second = queuedOutgoing("after", []);

    expect(nextQueued([first, second])).toBe(first);
    const sending: Outgoing = { ...first, status: "sent", baseline: 1 };

    expect(nextQueued([sending, second])).toBeNull();
    expect(settleOutbox([sending, second], [turn(0, [], "completed")])).toEqual([sending, second]);
    expect(settleOutbox([sending, second], [turn(0, [], "completed"), turn(1, [])])).toEqual([
      second,
    ]);
  });

  test("a failed follow-up waits for a retry", () => {
    const failed: Outgoing = { ...queuedOutgoing("x", []), status: "failed", error: "no" };

    expect(nextQueued([failed])).toBeNull();
  });
});

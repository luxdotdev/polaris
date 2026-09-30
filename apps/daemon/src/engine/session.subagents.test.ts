import { describe, expect, test } from "bun:test";
import { DomainEvent, Subagent, SubagentId, TurnId } from "@polaris/protocol";
import { workingTurn } from "../store/model.ts";
import { AT, initialSnapshot, SESSION, type ModelOptions, stepModel } from "./session.testing.ts";
import { decideSession } from "./session.ts";

const codex: ModelOptions = { harness: "codex", liveCoAttach: true, switchModel: true };

/** A session with a Turn in flight (the fake Harness opened and working). */
const working = () => {
  const started = stepModel(initialSnapshot(), { type: "start" }, codex).next;

  return started.machine.context.record!;
};

const subagent = (
  turnId: TurnId,
  id = "sub-1",
  end: { readonly status: "failed"; readonly endedAt: string } | null = null
) =>
  new Subagent({
    id: SubagentId.make(id),
    sessionId: SESSION,
    turnId,
    parentItemId: null,
    title: "Explore",
    agent: null,
    model: null,
    status: end?.status ?? "working",
    startedAt: AT,
    endedAt: end?.endedAt ?? null,
  });

const tagsOf = (events: ReadonlyArray<DomainEvent>) => events.map((e) => e._tag);

describe("session machine: Subagents", () => {
  const record = working();
  const turnId = workingTurn(record)!.id;

  const withSubagent = decideSession(record, {
    type: "harness.subagentStarted",
    subagent: subagent(turnId),
  }).next.context.record!;

  test("a Subagent starts only for the Turn in flight, and once", () => {
    expect(withSubagent.subagents.size).toBe(1);
    expect(withSubagent.session.state).toBe(record.session.state);

    const again = decideSession(withSubagent, {
      type: "harness.subagentStarted",
      subagent: subagent(turnId),
    });

    const stale = decideSession(record, {
      type: "harness.subagentStarted",
      subagent: subagent(TurnId.make("t-other"), "sub-2"),
    });

    expect([again.events, stale.events]).toEqual([[], []]);
  });

  test("it ends when the Harness says so, once", () => {
    const ended = decideSession(withSubagent, {
      type: "harness.subagentEnded",
      subagentId: SubagentId.make("sub-1"),
      status: "failed",
      at: AT,
    });

    expect(ended.events).toEqual([
      DomainEvent.cases.SubagentEnded.make({
        subagent: subagent(turnId, "sub-1", { status: "failed", endedAt: AT }),
      }),
    ]);
    expect(ended.next.context.record!.subagents.size).toBe(0);

    const repeat = decideSession(ended.next.context.record!, {
      type: "harness.subagentEnded",
      subagentId: SubagentId.make("sub-1"),
      status: "completed",
      at: AT,
    });

    expect(repeat.events).toEqual([]);
  });

  test("the Turn ending leaves it open; the Harness going away ends it interrupted", () => {
    const turnEnded = decideSession(withSubagent, {
      type: "harness.turnEnded",
      turnId,
      status: "completed",
      error: null,
      checkpoint: null,
      at: AT,
    }).next.context.record!;

    expect(turnEnded.subagents.size).toBe(1);

    const departures = [
      decideSession(turnEnded, { type: "harness.exited", error: null, at: AT }),
      decideSession(turnEnded, { type: "daemon.recover", cause: "restart", at: AT }),
      decideSession(turnEnded, { type: "session.fail", message: "boom", at: AT }),
      decideSession(turnEnded, { type: "session.archive", at: AT }),
    ];

    for (const departure of departures) {
      expect(tagsOf(departure.events)[0]).toBe("SubagentEnded");
      expect(departure.events[0]).toMatchObject({ subagent: { status: "interrupted" } });
      expect(departure.next.context.record!.subagents.size).toBe(0);
    }
  });
});

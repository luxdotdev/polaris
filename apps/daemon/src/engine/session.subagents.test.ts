import { describe, expect, test } from "bun:test";
import {
  BackgroundTask,
  DomainEvent,
  Subagent,
  SubagentId,
  TurnId,
  TurnTrigger,
} from "@polaris/protocol";
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
      report: null,
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
      report: null,
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

test("background work suppresses idle shutdown and its report starts a distinct Turn", () => {
  const record = working();
  const turnId = workingTurn(record)!.id;

  const spawned = decideSession(record, {
    type: "harness.subagentStarted",
    subagent: subagent(turnId),
  }).next.context.record!;

  const idle = decideSession(spawned, {
    type: "harness.turnEnded",
    turnId,
    status: "completed",
    error: null,
    checkpoint: null,
    at: AT,
  });

  expect(idle.effects).toEqual(["scheduleIdleStop"]);
  expect(
    decideSession(idle.next.context.record!, { type: "idle.timeout", harnessLive: true }).events
  ).toEqual([]);

  const reported = decideSession(idle.next.context.record!, {
    type: "harness.subagentEnded",
    subagentId: SubagentId.make("sub-1"),
    status: "completed",
    report: "**report**",
    at: AT,
  });

  expect(reported.events[0]).toMatchObject({ subagent: { report: "**report**" } });
  expect(reported.effects).toEqual(["scheduleIdleStop"]);

  const trigger = TurnTrigger.cases.BackgroundTasksReported.make({
    tasks: [{ id: "sub-1", kind: "subagent" }],
  });

  const auto = decideSession(reported.next.context.record!, {
    type: "harness.turnStarted",
    turnId: TurnId.make("auto1"),
    prompt: "",
    trigger,
    at: AT,
  });

  expect(auto.next.context.record!.session.state).toBe("working");
  expect(auto.events.map((e) => e._tag)).toEqual(["TurnStarted", "SessionStateChanged"]);
  const started = auto.events.find(DomainEvent.guards.TurnStarted);
  expect(started?.turn).toMatchObject({
    id: "auto1",
    index: 1,
    prompt: "[Background task continuation]",
    trigger,
  });
  expect(
    decideSession(auto.next.context.record!, {
      type: "harness.turnStarted",
      turnId: TurnId.make("auto2"),
      prompt: "",
      trigger,
      at: AT,
    }).events
  ).toEqual([]);
});

test("command waiting is recorded, prevents idle shutdown, and clears on recovery", () => {
  const task = new BackgroundTask({ id: "bash-1", kind: "command", description: "Sleep" });

  const started = decideSession(working(), {
    type: "harness.backgroundTasksChanged",
    tasks: [task],
  });

  const ended = decideSession(started.next.context.record!, {
    type: "harness.turnEnded",
    turnId: workingTurn(started.next.context.record!)!.id,
    status: "completed",
    error: null,
    checkpoint: null,
    at: AT,
  });

  expect(ended.next.context.record!.session.backgroundTasks).toEqual([task]);
  expect(ended.effects).toEqual(["scheduleIdleStop"]);
  expect(
    decideSession(ended.next.context.record!, { type: "idle.timeout", harnessLive: true }).events
  ).toEqual([]);

  const cleared = decideSession(ended.next.context.record!, {
    type: "harness.backgroundTasksChanged",
    tasks: [],
  });

  expect(cleared.effects).toEqual(["scheduleIdleStop"]);
  expect(cleared.next.context.record!.session.backgroundTasks).toEqual([]);

  const capped = decideSession(ended.next.context.record!, {
    type: "idle.timeout",
    harnessLive: true,
    backgroundExpired: true,
    at: AT,
  });

  expect(capped.effects).toEqual(["stopHarness"]);
  expect(capped.next.context.record!.session.backgroundTasks).toEqual([]);
  expect(capped.events.find(DomainEvent.guards.SessionStateChanged)).toMatchObject({
    state: "dormant",
    reason: "background-idle-timeout",
  });
  expect(
    decideSession(working(), {
      type: "idle.timeout",
      harnessLive: true,
      backgroundExpired: true,
      at: AT,
    }).events
  ).toEqual([]);

  const recovered = decideSession(ended.next.context.record!, {
    type: "daemon.recover",
    cause: "restart",
    at: AT,
  });

  expect(recovered.next.context.record!.session.backgroundTasks).toEqual([]);
  expect(recovered.next.context.record!.session.state).toBe("dormant");
  expect(
    decideSession(recovered.next.context.record!, {
      type: "harness.backgroundTasksChanged",
      tasks: [task],
    }).events
  ).toEqual([]);
});

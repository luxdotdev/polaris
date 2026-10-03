import { expect, test } from "bun:test";
import { DomainEvent, TurnItem } from "@polaris/protocol";
import { workingTurn } from "../store/model.ts";
import { decideSession, stateOf } from "./session.ts";
import { deferredInput, initialSnapshot, stepModel, type Step } from "./session.testing.ts";

const options = { harness: "claude", liveCoAttach: false, switchModel: false } as const;

const reached = (steps: ReadonlyArray<Step["type"]>) => {
  let snapshot = initialSnapshot();

  for (const type of steps) snapshot = stepModel(snapshot, { type }, options).next;

  return snapshot;
};

test.each([
  ["start"],
  ["start", "requestApproval"],
  ["start", "complete"],
  ["start", "failTurn"],
  ["start", "exit"],
  ["start", "complete", "archive"],
  ["start", "complete", "openTerminal"],
] satisfies Array<Array<Step["type"]>>)(
  "deferred delivery obeys the Session machine at %j",
  (...steps) => {
    const snapshot = reached(steps);
    const record = snapshot.machine.context.record!;
    const input = deferredInput(snapshot);
    const decision = decideSession(record, input);
    const working = workingTurn(record);

    if (working !== undefined && record.session.state !== "archived") {
      expect(decision.events).toEqual([]);
      expect(decision.effects).toEqual([{ type: "waitForTurn", turnId: working.id }]);
      expect(stateOf(decision.next)).toBe(record.session.state);
    } else {
      if (input.type !== "turn.deliver") throw new Error("Wrong input");
      const send = decideSession(record, { type: "turn.send", turn: input.turn });

      if (send.rejection === null) {
        expect(decision.events).toEqual(send.events);
        expect(decision.effects).toEqual(send.effects);
        expect(stateOf(decision.next)).toBe(stateOf(send.next));
      } else {
        expect(decision.events.filter(DomainEvent.guards.TurnStarted)).toHaveLength(0);
        expect(decision.events.filter(DomainEvent.guards.TurnItemCompleted)).toHaveLength(2);
        expect(decision.effects).toEqual([]);
      }
    }
  }
);

test("terminal refusal overrides waiting and is recorded by the machine without changing lifecycle", () => {
  const snapshot = reached(["start"]);
  const record = snapshot.machine.context.record!;
  const decision = decideSession(record, deferredInput(snapshot, "the Harness exited"));
  expect(decision.effects).toEqual([]);
  expect(stateOf(decision.next)).toBe(record.session.state);
  expect(
    decision.events
      .filter(DomainEvent.guards.TurnItemCompleted)
      .flatMap((e) => (TurnItem.guards.Error(e.item) ? [e.item.message] : []))
  ).toEqual(["Could not deliver the queued prompt: the Harness exited"]);
});

test("a deleted Session records refusal items without recreating its lifecycle", () => {
  const decision = decideSession(undefined, deferredInput(reached(["start"]), "deleted"));
  expect(decision.events.filter(DomainEvent.guards.TurnItemCompleted)).toHaveLength(2);
  expect(decision.events.filter(DomainEvent.guards.SessionCreated)).toHaveLength(0);
  expect(decision.effects).toEqual([]);
  expect(stateOf(decision.next)).toBe("new");
});

import { expect, test } from "bun:test";
import {
  CommandId,
  DomainEvent,
  EventEnvelope,
  HostStreamItem,
  Sequence,
  SessionStreamItem,
  SessionSummary,
} from "@polaris/protocol";
import { Schema } from "effect";
import { patchSession } from "../store/model.ts";
import { planHostItemsFor, planSessionItemsFor } from "./planCompat.ts";
import { AT, initialSnapshot, SESSION, stepModel } from "./session.testing.ts";

const planning = (() => {
  const options = { harness: "claude", liveCoAttach: false, switchModel: false } as const;
  const started = stepModel(initialSnapshot(), { type: "start" }, options).next;
  const { session } = started.machine.context.record!;

  return patchSession(session, { permissionMode: "plan" });
})();

const envelope = (event: DomainEvent) =>
  new EventEnvelope({
    sequence: Sequence.make(7),
    occurredAt: AT,
    commandId: CommandId.make("c"),
    event,
  });

const created = DomainEvent.cases.SessionCreated.make({ session: planning });

const changed = DomainEvent.cases.SessionPermissionModeChanged.make({
  sessionId: SESSION,
  permissionMode: "plan",
});

const snapshot = HostStreamItem.cases.Snapshot.make({
  sequence: Sequence.make(7),
  workspaces: [],
  worktrees: [],
  sessions: [
    new SessionSummary({
      session: planning,
      pendingApprovals: [],
      lastTurnPreview: null,
      subagents: [],
    }),
  ],
});

/** The permission modes in an item's wire JSON, as an older Client's decoder meets them. */
const modesIn = (wire: string): ReadonlyArray<string> =>
  [...wire.matchAll(/"permissionMode":"([^"]+)"/g)].map((match) => match[1]!);

const encodeHost = Schema.encodeSync(HostStreamItem);

const encodeSession = Schema.encodeSync(SessionStreamItem);

test("a Client that announced session.plan-mode gets plan as is", () => {
  expect(planHostItemsFor(["session.plan-mode"])).toBeNull();
  expect(planSessionItemsFor(["session.plan-mode"])).toBeNull();
});

test("an older Client reads a planning session as supervised, in snapshots and events", () => {
  const host = planHostItemsFor([])!;
  const session = planSessionItemsFor([])!;

  const hostItems = [
    host(snapshot),
    host(HostStreamItem.cases.Event.make({ envelope: envelope(created) })),
    host(HostStreamItem.cases.Event.make({ envelope: envelope(changed) })),
  ].map((item) => JSON.stringify(encodeHost(item)));

  const sessionItems = [
    session(
      SessionStreamItem.cases.Snapshot.make({
        sequence: Sequence.make(7),
        session: planning,
        turns: [],
        pendingApprovals: [],
      })
    ),
    session(SessionStreamItem.cases.Event.make({ envelope: envelope(created) })),
    session(SessionStreamItem.cases.Event.make({ envelope: envelope(changed) })),
  ].map((item) => JSON.stringify(encodeSession(item)));

  const items = [...hostItems, ...sessionItems];
  expect(items.map(modesIn)).toEqual(items.map(() => ["supervised"]));
});

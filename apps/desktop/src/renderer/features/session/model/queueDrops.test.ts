import { expect, test } from "bun:test";
import { Actor, DomainEvent, HostStreamItem, SessionSummary, TurnId } from "@polaris/protocol";
import { applyHostItems, emptyHostModel, type QueueDrop } from "../../../store/hostModel.ts";
import { envelope, seq, session, sessionId, workspace } from "../../../store/fixtures.testing.ts";
import { queueDropMessage, unseenQueueDrops } from "./queueDrops.ts";

const H = HostStreamItem.cases;

const snapshot = H.Snapshot.make({
  sequence: seq(3),
  workspaces: [workspace],
  worktrees: [],
  sessions: [
    new SessionSummary({ session, pendingApprovals: [], lastTurnPreview: null, subagents: [] }),
  ],
});

const cancelled = (sequence: number, turn: string, actor: Actor | null, reason: string | null) =>
  H.Event.make({
    envelope: envelope(
      sequence,
      DomainEvent.cases.QueuedTurnCancelled.make({
        sessionId,
        turnId: TurnId.make(turn),
        actor,
        reason,
      })
    ),
  });

// ENG-941: a Teammate who lost access had their queued Turn vanish with no word to anyone.
test("a queued Turn the Host won't start is toasted once with why; one a person cancelled is not", () => {
  const seen = new WeakSet<QueueDrop>();

  const toasts = (model: Parameters<typeof applyHostItems>[0]) =>
    unseenQueueDrops({ host: model }, seen).map(({ title, drop }) => queueDropMessage(title, drop));

  const byPerson = applyHostItems(emptyHostModel, [
    snapshot,
    cancelled(4, "t1", Actor.cases.Client.make({}), null),
  ]);

  const byHost = applyHostItems(byPerson, [cancelled(5, "t2", null, "Their share ended")]);

  expect([toasts(byPerson), toasts(byHost), toasts(byHost)]).toEqual([
    [],
    [`${session.title}: their share ended`],
    [],
  ]);
});

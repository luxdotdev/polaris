import { expect, test } from "bun:test";
import {
  Actor,
  ApprovalDecision,
  DomainEvent,
  EventEnvelope,
  LinkedDeviceId,
  PersonId,
  RequestId,
  Sequence,
  SessionId,
  SessionStreamItem,
  ShareId,
} from "@polaris/protocol";
import { Predicate, Schema } from "effect";
import { actorSessionItemsFor } from "./actorCompat.ts";

const phone = Actor.cases.LinkedDevice.make({
  deviceId: LinkedDeviceId.make("dev_1"),
  name: "Phone",
});

const teammate = Actor.cases.Teammate.make({
  shareId: ShareId.make("share_1"),
  personId: PersonId.make("p1"),
  name: "The Octocat",
});

const resolvedBy = (actor: Actor) =>
  SessionStreamItem.cases.Event.make({
    envelope: new EventEnvelope({
      sequence: Sequence.make(3),
      occurredAt: "2026-10-27T00:00:00.000Z",
      commandId: null,
      event: DomainEvent.cases.ApprovalResolved.make({
        sessionId: SessionId.make("s1"),
        requestId: RequestId.make("r1"),
        decision: ApprovalDecision.cases.Allow.make({ remember: false }),
        resolvedBy: "Someone",
        actor,
      }),
    }),
  });

/** What a Client from before Linked Devices decodes the Actor with. */
const OldActor = Schema.TaggedUnion({
  Client: {},
  Extension: { pairingId: Schema.String, name: Schema.String },
});

/** The approval's Actor as it goes on the wire. */
const encodeActor = Schema.encodeSync(Actor);

const actorIn = (item: SessionStreamItem): typeof Actor.Encoded | null | undefined => {
  if (
    !Predicate.isTagged(item, "Event") ||
    !Predicate.isTagged(item.envelope.event, "ApprovalResolved")
  )
    throw new Error("expected the approval event");
  const actor = item.envelope.event.actor;

  return actor == null ? actor : encodeActor(actor);
};

test.each([
  ["a Linked Device", phone, ["actor.teammate"]],
  ["a Teammate", teammate, ["actor.linked-device"]],
] as const)("a Client that can't decode %s reads its approval as a Client's", (_, actor, known) => {
  const old = actorSessionItemsFor(known);

  if (old === null) throw new Error("expected a rewrite for an older Client");
  const seen = actorIn(old(resolvedBy(actor)));

  expect(Schema.is(OldActor)(seen)).toBe(true);
  expect(seen).toEqual(encodeActor(Actor.cases.Client.make({})));
});

test.each([
  ["a Linked Device", phone, ["actor.linked-device"]],
  ["a Teammate", teammate, ["actor.teammate"]],
] as const)("a Client that announced %s's Actor sees it", (_, actor, known) => {
  const rewrite = actorSessionItemsFor(known) ?? ((item: SessionStreamItem) => item);

  expect(actorIn(rewrite(resolvedBy(actor)))).toEqual(encodeActor(actor));
});

test("a Client that decodes every Actor gets its items as they are", () => {
  expect(actorSessionItemsFor(["actor.linked-device", "actor.teammate"])).toBeNull();
});

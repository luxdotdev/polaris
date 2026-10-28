/**
 * Pushes held while the user is at a Desktop App (ENG-495). What they deal with there is
 * dropped: an answered or withdrawn request, a finished Turn they read, a notification
 * whose session they read after it. The rest go out when presence ends. Pure.
 */
import type { DomainEvent, HostStreamItem, ReadPosition } from "@polaris/protocol";
import { Match, Predicate } from "effect";
import type { Push } from "./plan.ts";

/** The most pushes held at once; past it the oldest go first. */
export const MAX_HELD = 200;

export type Held = ReadonlyArray<Push>;

export const hold = (held: Held, pushes: ReadonlyArray<Push>): Held =>
  pushes.length === 0 ? held : [...held, ...pushes].slice(-MAX_HELD);

const withoutRequest = (held: Held, requestId: string): Held =>
  held.filter(({ need }) => need.requestId !== requestId);

const settleEvent = (held: Held, event: DomainEvent): Held =>
  Match.value(event).pipe(
    Match.tags({
      ApprovalResolved: ({ requestId }) => withoutRequest(held, requestId),
      ApprovalWithdrawn: ({ requestId }) => withoutRequest(held, requestId),
    }),
    Match.orElse(() => held)
  );

/** Drops the held Needs You whose request this Host stream item shows answered or withdrawn. */
export const settleItem = (held: Held, item: HostStreamItem): Held =>
  held.length === 0 || !Predicate.isTagged(item, "Event")
    ? held
    : settleEvent(held, item.envelope.event);

const readThrough = (read: ReadPosition) => {
  const at = Date.parse(read.at);

  return ({ need }: Push) =>
    need.sessionId === read.sessionId &&
    need.requestId === null &&
    (need.turnIndex === null ? at >= need.at : read.turnIndex >= need.turnIndex);
};

/** Drops the finished Turns and notifications a read position shows seen. */
export const settleRead = (held: Held, read: ReadPosition): Held => {
  const seen = readThrough(read);

  return held.length === 0 ? held : held.filter((push) => !seen(push));
};

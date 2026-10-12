/**
 * Per-Mac dismissal (N1; Paper 10, 10b): a dismissed inbox item is hidden on this Mac until
 * its session changes, then it comes back. Nothing is withdrawn on the Host. Pure, so tested.
 */
import { needsYou } from "../../../routes/topBar.ts";
import type { AlsoWaiting, Inbox, WaitingSession } from "./inbox.ts";

/** Inbox key → the activity it was dismissed at. */
export type Dismissed = ReadonlyMap<string, string>;

/** A waiting session's activity: its open requests, so a new one brings it back. */
const waitingStamp = (w: WaitingSession) => `requests:${w.requests.map((r) => r.id).join(",")}`;

/** An "Also waiting" item's activity: what it is and when its session last changed. */
const alsoStamp = (a: AlsoWaiting) => `${a.kind}:${a.entry.session.updatedAt}`;

export interface DismissedInbox<I extends Inbox> {
  readonly inbox: I;
  /** How many items are hidden now. */
  readonly hidden: number;
  /**
   * The dismissals to keep: all but those whose item came back with new activity. An item
   * that isn't in the inbox now (its Host still connecting) keeps its dismissal.
   */
  readonly current: Dismissed;
  /** Keys of sessions that need you but are hidden here, so chips don't count them either. */
  readonly quiet: ReadonlySet<string>;
}

export type Dismissible = WaitingSession | AlsoWaiting;

export const stampOf = (item: Dismissible) =>
  "requests" in item ? waitingStamp(item) : alsoStamp(item);

/** Hides what was dismissed at its current activity, and takes it out of the count. */
export const applyDismissed = <I extends Inbox>(
  inbox: I,
  dismissed: Dismissed
): DismissedInbox<I> => {
  const current = new Map(dismissed);
  const hidden = new Set<string>();

  const keep = (item: Dismissible) => {
    const at = dismissed.get(item.key);

    if (at === undefined) return true;

    if (at !== stampOf(item)) {
      current.delete(item.key);

      return true;
    }

    hidden.add(item.key);

    return false;
  };

  const waiting = inbox.waiting.filter(keep);
  const also = inbox.also.filter(keep);

  const counted = new Set(
    [...inbox.waiting, ...inbox.also].flatMap((i) =>
      hidden.has(i.key) && needsYou(i.entry) ? [i.key] : []
    )
  );

  return {
    inbox: { ...inbox, waiting, also, count: Math.max(0, inbox.count - counted.size) },
    hidden: hidden.size,
    current,
    quiet: counted,
  };
};

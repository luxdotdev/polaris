/**
 * The sidebar's sections (Paper 12, 12b): Pinned on top in pin order, then the sessions,
 * then Reviews, a Reviewer's and walkthrough's own sessions. Pure, so it is tested.
 */
import type { AgentSession } from "@polaris/protocol";
import { needsYou } from "../../../routes/topBar.ts";
import type { SessionEntry } from "../../../store/hostModel.ts";

type Identified = Pick<AgentSession, "cwd" | "title"> & {
  readonly origin?: AgentSession["origin"];
};

/**
 * A Reviewer's or walkthrough's own read-only session: marked by the Daemon (`origin`), or,
 * for one started before that, run in a Review Checkout or titled "Reviewer · …".
 */
export const isReviewSession = (session: Identified) =>
  session.origin != null ||
  /[/\\]\.review[/\\]/.test(session.cwd) ||
  session.title.startsWith("Reviewer · ") ||
  session.title.startsWith("Walkthrough · ");

export interface Sections<T> {
  readonly pinned: ReadonlyArray<T>;
  readonly sessions: ReadonlyArray<T>;
  readonly reviews: ReadonlyArray<T>;
}

const pinnedAt = (entry: SessionEntry) => entry.session.pinnedAt ?? null;

/**
 * Splits rows (in sidebar order) into sections. A pinned session stays in Pinned even when
 * it needs you (owner, 2026-10-12); pins keep the order they were made in.
 */
export const sectionsOf = <T>(
  items: ReadonlyArray<T>,
  entryOf: (item: T) => SessionEntry
): Sections<T> => {
  const pinned = items
    .filter((i) => pinnedAt(entryOf(i)) !== null)
    .sort((a, b) => (pinnedAt(entryOf(a)) ?? "").localeCompare(pinnedAt(entryOf(b)) ?? ""));

  const rest = items.filter((i) => pinnedAt(entryOf(i)) === null);

  return {
    pinned,
    sessions: rest.filter((i) => !isReviewSession(entryOf(i).session)),
    reviews: rest.filter((i) => isReviewSession(entryOf(i).session)),
  };
};

/** Reviews opens on its own while one of its sessions needs you (owner, 2026-10-12). */
export const reviewsOpen = (reviews: ReadonlyArray<SessionEntry>, folded: boolean | undefined) =>
  reviews.some(needsYou) || folded === false;

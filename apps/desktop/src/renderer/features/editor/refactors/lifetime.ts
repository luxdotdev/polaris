/**
 * How long a refactor's draft group lives (DESIGN.md, Editor: Refactor recovery). Only an
 * unresolved multi-file or file-operation outcome ever needs the user; everything else expires.
 */
import type { DraftGroup } from "./group.ts";

/** When this window's Editor loaded; groups from before it belong to an earlier launch. */
export const launchedAt = Date.now();

/** A multi-file or file-operation refactor, which a later session may need to resolve. */
export const coordinated = (group: Pick<DraftGroup, "touched" | "proposal">) =>
  group.touched.length > 1 ||
  group.proposal.resourceSnapshots.length > 0 ||
  (group.proposal.edit.documentChanges?.some((change) => "kind" in change) ?? false);

/** Whether the group's outcome needs the user: unknown or partially applied, across files. */
export const needsUser = (group: Pick<DraftGroup, "state" | "touched" | "proposal">) =>
  (group.state === "unknown" || group.state === "partial") && coordinated(group);

/** The group still carries unsaved text the Editor projects as a file's draft. */
const holdsDrafts = (group: Pick<DraftGroup, "documents">) =>
  group.documents.some((document) => document.dirty);

/**
 * Whether a stored group can be deleted: its undo is over (superseded, restored, or from an
 * earlier launch) or it's a one-file or text-only change left from one, and it holds no drafts.
 */
export const expired = (group: DraftGroup, since = launchedAt) => {
  if (holdsDrafts(group)) return false;

  if (group.state === "conflict" || group.state === "restored") return true;

  if (group.updatedAt >= since) return false;

  return group.state === "applied" || !coordinated(group);
};

/**
 * The sidebar's Reviews group (Paper 12, 12b): a Reviewer's and walkthrough's sessions,
 * folded by default, open on its own while one of them needs you.
 */
import { DisclosureChevron } from "@polaris/ui";
import type { ReactNode } from "react";
import { useNav, useShellActions } from "../../../shell/hooks.ts";
import type { SessionEntry } from "../../../store/hostModel.ts";
import { needsYou } from "../../../routes/topBar.ts";
import { reviewsOpen } from "../model/sections.ts";

/** The fold key for a Workspace's (or, in machine mode, a Host's) Reviews group. */
export const reviewsKey = (scope: string) => `reviews\u0000${scope}`;

export interface ReviewsGroupProps {
  readonly foldKey: string;
  readonly entries: ReadonlyArray<SessionEntry>;
  readonly children: ReactNode;
}

export const ReviewsGroup = ({ foldKey, entries, children }: ReviewsGroupProps) => {
  const { toggleFolded } = useShellActions();
  const folded = useNav((s) => s.folded[foldKey]);
  const held = entries.some(needsYou);
  const open = reviewsOpen(entries, folded);

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col pt-1.5" data-testid="reviews-group">
      <button
        type="button"
        aria-expanded={open}
        aria-disabled={held}
        title={held ? "Stays open while a review needs you" : undefined}
        onClick={() => {
          if (!held) toggleFolded(foldKey, !open);
        }}
        className="h-tree-row text-caption flex cursor-default items-center gap-1.5 px-2"
      >
        <DisclosureChevron open={open} className="text-text-faint" />
        <span className="text-text-subtle flex-1 text-left font-medium">Reviews</span>
        <span className="text-text-subtle tabular">{entries.length}</span>
      </button>
      {open ? children : null}
    </div>
  );
};

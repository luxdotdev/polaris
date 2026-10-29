/**
 * The pane once a review or a merge emptied its queue group (DESIGN.md, Review → Queue):
 * what moved to Reviewed or merged, and the way back to it. Opening any row leaves it.
 */
import { Button, EmptyState, Panel, PixelCheckIcon } from "@polaris/ui";
import type { OpenPull } from "../../../../shared/api.ts";
import type { Moved, QueueGroup } from "../model/queue.ts";

const TITLES: Partial<Record<QueueGroup["id"], string>> = {
  requested: "No more review requests",
  mine: "No more pull requests of yours",
  other: "No more open pull requests",
  reviewed: "Nothing left in Reviewed",
};

const FACTS: Readonly<Record<Moved, (n: number) => string>> = {
  reviewed: (n) => `#${n} moved to Reviewed. New commits bring it back.`,
  merged: (n) => `#${n} merged.`,
};

export interface QueueDoneProps {
  readonly pull: OpenPull;
  readonly group: QueueGroup["id"];
  readonly moved?: Moved | undefined;
  /** Back to the pull request just reviewed. */
  readonly onBack: () => void;
}

export const QueueDone = ({ pull, group, moved = "reviewed", onBack }: QueueDoneProps) => (
  <Panel asChild className="mb-2 min-w-0 flex-1 items-center justify-center">
    <section data-testid="review-queue-done">
      <EmptyState
        icon={<PixelCheckIcon size={24} />}
        title={TITLES[group] ?? "Nothing left here"}
        fact={FACTS[moved](pull.number)}
        action={
          <Button size="sm" variant="secondary" onClick={onBack}>
            Show #{pull.number}
          </Button>
        }
      />
    </section>
  </Panel>
);

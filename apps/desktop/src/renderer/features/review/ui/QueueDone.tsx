/**
 * The pane once a review emptied its queue group (DESIGN.md, Review → Queue): what moved
 * to Reviewed, and the way back to it. Opening any row in the queue leaves it.
 */
import { Button, EmptyState, PixelCheckIcon } from "@polaris/ui";
import type { OpenPull } from "../../../../shared/api.ts";
import type { QueueGroup } from "../model/queue.ts";

const TITLES: Partial<Record<QueueGroup["id"], string>> = {
  requested: "No more review requests",
  other: "No more open pull requests",
};

export interface QueueDoneProps {
  readonly pull: OpenPull;
  readonly group: QueueGroup["id"];
  /** Back to the pull request just reviewed. */
  readonly onBack: () => void;
}

export const QueueDone = ({ pull, group, onBack }: QueueDoneProps) => (
  <section
    data-testid="review-queue-done"
    className="bg-bg flex min-w-0 flex-1 items-center justify-center"
  >
    <EmptyState
      icon={<PixelCheckIcon size={24} />}
      title={TITLES[group] ?? "Nothing left here"}
      fact={`#${pull.number} moved to Reviewed. New commits bring it back.`}
      action={
        <Button size="sm" variant="secondary" onClick={onBack}>
          Show #{pull.number}
        </Button>
      }
    />
  </section>
);

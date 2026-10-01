/**
 * An Agent Session's comments in the diff: drafts waiting in the batch (removable), and
 * comments already sent, marked with their Turn ("sent with turn 25").
 */
import { Button } from "@polaris/ui";
import { removeFeedback } from "../data/actions.ts";
import { useComments } from "../data/store.ts";
import type { SentComment } from "../model/feedback.ts";

const Row = ({
  children,
  testId,
}: {
  readonly children: React.ReactNode;
  readonly testId: string;
}) => (
  <div className="pr-panel py-gap flex pl-[78px] font-sans" data-testid={testId}>
    <div className="rounded-row bg-surface-raised border-hairline flex min-w-0 flex-1 flex-col gap-1.5 border p-3">
      {children}
    </div>
  </div>
);

export const DraftRow = ({
  subjectKey,
  draftId,
}: {
  readonly subjectKey: string;
  readonly draftId: string;
}) => {
  const draft = useComments((s) => s.batches[subjectKey]?.comments.find((c) => c.id === draftId));
  const nextTurn = useComments((s) => s.sessions[subjectKey]?.nextTurn ?? null);

  if (draft === undefined) return null;

  return (
    <Row testId="feedback-draft">
      <div className="gap-gap flex items-center">
        <span className="text-body text-text-strong font-medium">You</span>
        <span className="bg-fill-selected text-text-subtle text-micro rounded-[5px] px-1.5 py-px font-medium">
          Draft
        </span>
        <span className="flex-1" />
        {nextTurn !== null && (
          <span className="text-caption text-text-faint">Goes with turn {nextTurn}</span>
        )}
        <Button size="xs" variant="ghost" onClick={() => removeFeedback(subjectKey, draftId)}>
          Remove
        </Button>
      </div>
      <p className="text-body text-text-default break-words whitespace-pre-wrap">{draft.note}</p>
    </Row>
  );
};

export const SentRow = ({ sent }: { readonly sent: SentComment }) => (
  <Row testId="feedback-sent">
    <div className="gap-gap flex items-center">
      <span className="text-body text-text-subtle font-medium">You</span>
      <span className="flex-1" />
      <span className="text-caption text-text-faint">Sent with turn {sent.turnNumber}</span>
    </div>
    <p className="text-body text-text-subtle break-words whitespace-pre-wrap">
      {sent.comment.note}
    </p>
  </Row>
);

/**
 * Review with a subject open (DESIGN.md, Review; Paper R1, R2): the queue, then the
 * subject's header, risk column and diff. Pierre's worker pool lives while this is mounted.
 */
import type { OpenPull } from "../../../../shared/api.ts";
import {
  closeReviewSubject,
  openPull,
  openSessionReview,
  type ReviewSubject,
} from "../../../routes/review.ts";
import { useApp, useShellActions } from "../../../shell/hooks.ts";
import { usePulls } from "../../pulls/store.ts";
import "../checkout/install.ts";
import { DiffWorkers } from "../data/pierre.tsx";
import { queueGroups, type QueueRow, type SessionInfo } from "../model/queue.ts";
import type { AppState } from "../../../store/store.ts";
import { PullReview } from "./PullReview.tsx";
import { Queue } from "./Queue.tsx";
import { SessionReview } from "./SessionReview.tsx";
import "../../risk/install.ts";

export interface ReviewViewProps {
  readonly subject: ReviewSubject;
  /** Back to the pull request list. */
  readonly onBack: () => void;
}

/**
 * A Reviewer's own read-only session has nothing to review: it runs inside a Review
 * Checkout (`.review/pr-N`), or is titled "Reviewer · …" (an Agent Session's, in place).
 */
const isReviewer = (cwd: string, title: string) =>
  /[/\\]\.review[/\\]/.test(cwd) || title.startsWith("Reviewer · ");

const sessionsOf = (models: AppState["hostModels"]): ReadonlyArray<SessionInfo> =>
  Object.entries(models).flatMap(([hostKey, model]) =>
    [...model.sessions.values()].flatMap(({ session }) =>
      isReviewer(session.cwd, session.title)
        ? []
        : [
            {
              hostKey,
              id: session.id,
              title: session.title,
              harness: session.harness,
              state: session.state,
              turnCount: session.turnCount,
              acceptedThroughIndex: session.acceptedThroughIndex ?? null,
              updatedAt: session.updatedAt,
              workspaceName: model.workspaces.get(session.workspaceId)?.name ?? null,
            },
          ]
    )
  );

const selectedId = (subject: ReviewSubject) =>
  subject.kind === "pull"
    ? (subject.pull.pullId ?? null)
    : `${subject.hostKey}:${subject.sessionId}`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const ReviewView = ({ subject, onBack }: ReviewViewProps) => {
  const actions = useShellActions();
  const list = usePulls((s) => s.list);
  const models = useApp((s) => s.hostModels);
  const hosts = useApp((s) => s.hosts.length);
  const workspaces = Object.values(models).reduce((n, m) => n + m.workspaces.size, 0);
  const groups = queueGroups(list, sessionsOf(models));

  const open = (row: QueueRow) =>
    row.kind === "pull"
      ? openPull(actions, row.pull)
      : openSessionReview(actions, row.hostKey, row.sessionId);

  return (
    <DiffWorkers>
      <div className="flex min-h-0 flex-1" data-testid="review-view">
        <Queue
          groups={groups}
          caption={`${plural(hosts, "host")} · ${plural(workspaces, "workspace")}`}
          selected={selectedId(subject)}
          onOpen={open}
          onOpenPull={(pull: OpenPull) => openPull(actions, pull)}
          onList={() => {
            closeReviewSubject();
            onBack();
          }}
        />
        {subject.kind === "pull" ? (
          <PullReview
            key={`${subject.pull.repo.owner}/${subject.pull.repo.name}#${subject.pull.number}`}
            subject={subject}
          />
        ) : (
          <SessionReview key={`${subject.hostKey}:${subject.sessionId}`} subject={subject} />
        )}
      </div>
    </DiffWorkers>
  );
};

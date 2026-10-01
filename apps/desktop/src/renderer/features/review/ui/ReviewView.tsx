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
import { useStore } from "zustand";
import { usePulls } from "../../pulls/store.ts";
import "../checkout/install.ts";
import { DiffWorkers } from "../data/pierre.tsx";
import { riskMark } from "../model/findings.ts";
import { queueGroups, type QueueRow } from "../model/queue.ts";
import { sessionsOf } from "../model/sessions.ts";
import { subjectKey, surfaceStore } from "../surface.ts";
import { PullReview } from "./PullReview.tsx";
import { Queue } from "./Queue.tsx";
import { SessionReview } from "./SessionReview.tsx";
import "../../risk/install.ts";
// The session's accept action fills its slot (M2-A).
import "../../accept/install.ts";

export interface ReviewViewProps {
  readonly subject: ReviewSubject;
  /** Back to the pull request list. */
  readonly onBack: () => void;
}

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
  const surfaces = useStore(surfaceStore, (s) => s);

  const markOf = (row: QueueRow) =>
    riskMark(
      surfaces[
        subjectKey(
          row.kind === "pull"
            ? { kind: "pull", pull: row.pull }
            : { kind: "session", hostKey: row.hostKey, sessionId: row.sessionId }
        )
      ]?.findings ?? []
    );

  const open = (row: QueueRow) =>
    row.kind === "pull"
      ? openPull(actions, row.pull)
      : openSessionReview(actions, row.hostKey, row.sessionId);

  return (
    <DiffWorkers>
      <div className="flex min-h-0 flex-1" data-testid="review-view">
        <Queue
          groups={groups}
          markOf={markOf}
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

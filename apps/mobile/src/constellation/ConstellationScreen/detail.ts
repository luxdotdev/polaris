/**
 * The task sheet's readouts (Paper MX-Z): status, attempt, claim and worker for one star, from
 * the folded graph. Pure; the sheet renders it.
 */
import type { Attempt, HarnessKind } from "@polaris/protocol";
import { harnessEntry } from "@polaris/protocol";
import type { StarState, StarTask } from "../../starChart/index.ts";
import { age, idRanges, shortSha } from "../copy.ts";
import type { ConstellationSource } from "../model.ts";

export interface Readout {
  readonly value: string;
  readonly detail: string | null;
}

export interface TaskDetail {
  readonly taskId: string;
  /** "Task B3 · wave 3". */
  readonly kicker: string;
  readonly title: string;
  readonly state: StarState;
  readonly status: Readout;
  readonly attempt: Readout;
  readonly claim: Readout;
  readonly worker: Readout & { readonly harness: HarnessKind | null };
  readonly branch: string | null;
  /** `Attempt 1 was sent back: "…"`, when the attempt before this one was. */
  readonly sentBack: string | null;
  /** The worker's agent session, for Open worker. */
  readonly session: { readonly hostId: string; readonly sessionId: string } | null;
  /** A claim waiting on review: Review claim opens it. */
  readonly reviewable: boolean;
}

const WORD: Readonly<Record<StarState, string>> = {
  done: "Done",
  working: "Working",
  review: "Review",
  blocked: "Blocked",
  failed: "Failed",
  waiting: "Waiting",
};

const counted = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const statusDetail = (
  source: ConstellationSource,
  star: StarTask,
  attempt: Attempt | null,
  now: number
): string | null => {
  const p = source.projections.find((x) => x.taskId === star.id);

  if (star.state === "review" && attempt?.claimedAt != null)
    return `claim waiting ${age(attempt.claimedAt, now)}`;

  if (star.state === "working")
    return (
      p?.liveness?.current?.command ??
      (attempt === null ? null : `started ${age(attempt.startedAt, now)} ago`)
    );

  if (star.state === "blocked") return attempt?.blockedReason ?? null;

  if (star.state === "failed") return attempt?.settleReason ?? attempt?.failureKind ?? null;

  if (star.state === "done" && attempt?.endedAt != null)
    return `accepted ${age(attempt.endedAt, now)} ago`;

  return p !== undefined && p.blockedBy.length > 0 ? `after ${idRanges(p.blockedBy)}` : null;
};

const claimReadout = (attempt: Attempt | null, state: StarState): Readout => {
  const claim = attempt?.claim ?? null;

  if (claim === null) return { value: "None yet", detail: null };
  const detail = `${shortSha(claim.head)} · ${counted(claim.receipts.length, "check")}`;

  if (state === "done") return { value: "Accepted", detail };

  return { value: state === "review" ? "Ready" : "Sent", detail };
};

const workerReadout = (
  source: ConstellationSource,
  taskId: string,
  attempt: Attempt | null,
  hostName: (hostId: string) => string,
  now: number
): TaskDetail["worker"] => {
  const task = source.constellation.tasks.find((t) => t.id === taskId);
  const harness = task?.suggested?.harness ?? null;
  const name = harness === null ? "Not chosen" : (harnessEntry(harness)?.name ?? harness);

  if (attempt === null) return { value: name, detail: null, harness };
  const until = attempt.endedAt == null ? now : Date.parse(attempt.endedAt);

  return {
    value: name,
    detail: `${hostName(attempt.hostId)} · ${age(attempt.startedAt, until)}`,
    harness,
  };
};

const sentBackNote = (attempts: ReadonlyArray<Attempt>): string | null => {
  const back = attempts
    .slice(0, -1)
    .reverse()
    .find((a) => a.rejectionReason != null);

  if (back === undefined) return null;
  const n = attempts.indexOf(back) + 1;

  return `Attempt ${n} was sent back: "${back.rejectionReason ?? ""}"`;
};

/** The sheet for one star; null once its task leaves the chart. */
export const taskDetail = (
  source: ConstellationSource,
  star: StarTask,
  hostName: (hostId: string) => string,
  now: number
): TaskDetail | null => {
  const { constellation: c } = source;
  const task = c.tasks.find((t) => t.id === star.id);

  if (task === undefined) return null;
  const attempts = c.attempts.filter((a) => a.taskId === star.id);
  const latestId = source.projections.find((p) => p.taskId === star.id)?.latestAttemptId ?? null;
  const attempt = attempts.find((a) => a.id === latestId) ?? attempts.at(-1) ?? null;
  const rejected = attempts.filter((a) => a.state === "rejected").length;

  return {
    taskId: star.id,
    kicker: `Task ${star.label} · wave ${star.wave}`,
    title: task.title,
    state: star.state,
    status: { value: WORD[star.state], detail: statusDetail(source, star, attempt, now) },
    attempt: {
      value: attempts.length === 0 ? "None yet" : String(attempts.length),
      detail: rejected === 0 ? null : `${rejected} rejected`,
    },
    claim: claimReadout(attempt, star.state),
    worker: workerReadout(source, star.id, attempt, hostName, now),
    branch: attempt?.branch ?? null,
    sentBack: sentBackNote(attempts),
    session: attempt === null ? null : { hostId: attempt.hostId, sessionId: attempt.sessionId },
    reviewable: star.state === "review" && attempt?.claim != null,
  };
};

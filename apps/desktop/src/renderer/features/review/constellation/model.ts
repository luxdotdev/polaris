/**
 * Review of a worker session (spec §7; DESIGN.md, Constellation (DAG) → From Review; Paper C4):
 * its header caption, which action leads, and a send-back reason from the feedback batch.
 */
import type { Attempt } from "@polaris/protocol";
import { Match } from "effect";
import type { Plain } from "../../../store/plain.ts";
import { type DraftBatch, draftPlace } from "../../comments/model/feedback.ts";

/** "worker of Constellations v1 lead · claim in review at 3f9c2e1". */
export const workerCaption = (attempt: Plain<Attempt>, leadName: string) => {
  const head = attempt.claim?.head.slice(0, 7);

  const state = Match.value(attempt.state).pipe(
    Match.when("review", () =>
      head === undefined ? "claim in review" : `claim in review at ${head}`
    ),
    Match.when("working", () => "working on its task"),
    Match.when("accepted", () =>
      attempt.mergedHead == null ? "accepted" : `accepted at ${attempt.mergedHead.slice(0, 7)}`
    ),
    Match.when("rejected", () => "sent back"),
    Match.when("failed", () => "failed"),
    Match.when("lost", () => "lost"),
    Match.when("settled_unverified", () => "settled unverified"),
    Match.exhaustive
  );

  return `worker of ${leadName} · ${state}`;
};

export type WorkerActionKind = "review" | "settled" | "working";

/** A Claim in review gets Approve and its menu; otherwise the header says why there is none. */
export const workerActionKind = (attempt: Plain<Attempt>): WorkerActionKind =>
  Match.value(attempt.state).pipe(
    Match.when("review", (): WorkerActionKind => "review"),
    Match.when("working", (): WorkerActionKind => "working"),
    Match.orElse((): WorkerActionKind => "settled")
  );

/** The feedback batch as one send-back reason: the message, then each comment at its place. */
export const sendBackReason = (batch: DraftBatch): string | null => {
  const message = batch.message.trim();

  const comments = batch.comments.map((c) =>
    [`${draftPlace(c)}: ${c.note}`, c.code === "" ? null : indent(c.code)]
      .filter((part) => part !== null)
      .join("\n")
  );

  const parts = [message === "" ? null : message, ...comments].filter((p) => p !== null);

  return parts.length === 0 ? null : parts.join("\n\n");
};

const indent = (code: string) =>
  code
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

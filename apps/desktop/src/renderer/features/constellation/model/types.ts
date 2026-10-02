/**
 * The Constellation read model: the protocol's folded graph plus what the tab needs that a
 * Snapshot doesn't carry (proposals, handovers, digests, progress notes), as plain records.
 */
import type {
  Attempt,
  AttemptProgress,
  ConstellationDigest,
  ConstellationHandover,
  ConstellationProposal,
  ConstellationSummary,
  PendingOperatorMessage,
  AttemptId,
  Claim,
  Constellation,
  ConstellationNotification,
  Task,
  TaskId,
  TaskProjection,
} from "@polaris/protocol";
import type { Plain } from "../../../store/plain.ts";

export type ConstellationData = Plain<Constellation>;

export type TaskData = Plain<Task>;

export type AttemptData = Plain<Attempt>;

export type ClaimData = Plain<Claim>;

export type ProjectionData = Plain<TaskProjection>;

export type NotificationData = Plain<ConstellationNotification>;

/** What shellui and other features read: the graph and its Task projections. */
export interface ConstellationView {
  readonly constellation: ConstellationData;
  readonly projections: ReadonlyArray<ProjectionData>;
}

export type Handover = Plain<ConstellationHandover>;

export type Proposal = Plain<ConstellationProposal>;

export type Digest = Plain<ConstellationDigest>;

export type Progress = Plain<AttemptProgress>;

export type OperatorMessage = Plain<PendingOperatorMessage>;

export type SummaryData = Plain<ConstellationSummary>;

/** One graph as its own stream delivered it: the Snapshot, then every event since. */
export interface ConstellationRecord extends ConstellationView {
  /** The stream's last sequence, where a resubscribe resumes. */
  readonly sequence: number;
  readonly proposals: ReadonlyArray<Proposal>;
  readonly handovers: ReadonlyArray<Handover>;
  readonly digests: ReadonlyArray<Digest>;
  /** Every notification seen, by id, so a digest can name its items. */
  readonly notifications: ReadonlyMap<string, NotificationData>;
  readonly progress: ReadonlyMap<AttemptId, Progress>;
  /** Operator messages not yet resolved (delivered), in send order. */
  readonly messages: ReadonlyArray<OperatorMessage>;
}

/**
 * One Host's Constellations: the Host feed's listing, and each listed graph's contents from
 * its own `constellation.subscribe` stream.
 */
export interface ConstellationsModel {
  readonly listed: ReadonlyMap<string, SummaryData>;
  readonly byId: ReadonlyMap<string, ConstellationRecord>;
}

export const emptyConstellations: ConstellationsModel = { listed: new Map(), byId: new Map() };

export type { AttemptId, TaskId };

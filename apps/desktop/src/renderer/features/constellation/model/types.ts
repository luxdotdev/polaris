/**
 * The Constellation read model: the protocol's folded graph plus what the tab needs that a
 * Snapshot doesn't carry (proposals, handovers, digests, progress notes), as plain records.
 */
import type {
  Attempt,
  AttemptId,
  Claim,
  Constellation,
  ConstellationNotification,
  MessageAuthority,
  MessageTarget,
  Task,
  TaskDefinition,
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

export interface Handover {
  readonly from: string;
  readonly to: string;
  readonly summary: string;
  readonly revision: number;
  readonly at: string;
  /** The graph as it stood when the Lead changed (C9's structured part). */
  readonly before: {
    readonly projections: ReadonlyArray<ProjectionData>;
    readonly inFlight: ReadonlyArray<AttemptData>;
    readonly questions: ReadonlyArray<NotificationData>;
    readonly undelivered: ReadonlyArray<OperatorMessage>;
  };
}

export interface Proposal {
  readonly proposalId: string;
  readonly by: AttemptId;
  readonly task: Plain<TaskDefinition>;
  readonly at: string;
}

/** A digest Turn: the notifications one `LeadNotified` delivered to the Lead. */
export interface Digest {
  readonly turnId: string;
  readonly leadSessionId: string;
  readonly revision: number;
  readonly at: string;
  readonly items: ReadonlyArray<NotificationData>;
}

export interface Progress {
  readonly note: string;
  readonly completed: number | null;
  readonly total: number | null;
  readonly at: string;
}

export interface OperatorMessage {
  readonly id: string;
  readonly authority: MessageAuthority;
  readonly target: MessageTarget;
  readonly text: string;
  readonly at: string;
}

export interface ConstellationRecord extends ConstellationView {
  readonly sequence: number;
  readonly proposals: ReadonlyArray<Proposal>;
  readonly handovers: ReadonlyArray<Handover>;
  readonly digests: ReadonlyArray<Digest>;
  /** Every notification seen, by id, so a digest can name its items. */
  readonly notifications: ReadonlyMap<string, NotificationData>;
  readonly progress: ReadonlyMap<AttemptId, Progress>;
  /** When each Attempt claimed, for review times. */
  readonly claimedAt: ReadonlyMap<AttemptId, string>;
  /** Operator messages not yet resolved (delivered), in send order. */
  readonly messages: ReadonlyArray<OperatorMessage>;
}

/** One Host's Constellations, by id. */
export interface ConstellationsModel {
  readonly byId: ReadonlyMap<string, ConstellationRecord>;
}

export const emptyConstellations: ConstellationsModel = { byId: new Map() };

export type { AttemptId, TaskId };

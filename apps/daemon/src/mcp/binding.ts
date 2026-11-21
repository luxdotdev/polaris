import { AttemptId, ConstellationId, SessionId, WorkspaceId } from "@polaris/protocol";
import { Schema } from "effect";

export const McpBinding = Schema.TaggedUnion({
  Plain: { sessionId: SessionId, constellationId: ConstellationId, workspaceId: WorkspaceId },
  /** `next` is set once the Constellation completes or is archived: the id `plan` starts next. */
  Lead: {
    sessionId: SessionId,
    constellationId: ConstellationId,
    next: Schema.optionalKey(ConstellationId),
  },
  Worker: { sessionId: SessionId, constellationId: ConstellationId, attemptId: AttemptId },
  /** An Inspector (ADR 0119): bound to one Inspection of one Attempt's Claim, and to nothing else. */
  Inspector: {
    sessionId: SessionId,
    constellationId: ConstellationId,
    attemptId: AttemptId,
    inspectionId: Schema.NonEmptyString,
  },
});

export type McpBinding = typeof McpBinding.Type;

export interface SessionBinding {
  readonly kind: "session";
  readonly sessionId: SessionId;
}

export const sessionBinding = (binding: McpBinding): SessionBinding => ({
  kind: "session",
  sessionId: binding.sessionId,
});

import { AttemptId, ConstellationId, SessionId, WorkspaceId } from "@polaris/protocol";
import { Schema } from "effect";

export const McpBinding = Schema.TaggedUnion({
  Plain: { sessionId: SessionId, constellationId: ConstellationId, workspaceId: WorkspaceId },
  Lead: { sessionId: SessionId, constellationId: ConstellationId },
  Worker: { sessionId: SessionId, constellationId: ConstellationId, attemptId: AttemptId },
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

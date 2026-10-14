/** Host models and Hosts for the Needs You inbox tests. */
import {
  AgentSession,
  ApprovalRequest,
  HostStreamItem,
  RequestId,
  SessionId,
  SessionSummary,
} from "@polaris/protocol";
import type { HostView } from "../../../../shared/api.ts";
import { at, seq, session, turnId, workspace } from "../../../store/fixtures.testing.ts";
import { applyHostItems, emptyHostModel, type HostModel } from "../../../store/hostModel.ts";

export const minutes = (n: number) => new Date(Date.parse(at) + n * 60_000).toISOString();

export const request = (
  id: string,
  sessionId: string,
  openedAt: string,
  kind: ApprovalRequest["kind"] = "command"
) =>
  new ApprovalRequest({
    title: "Run bun test",
    detail: null,
    options: [],
    id: RequestId.make(id),
    sessionId: SessionId.make(sessionId),
    turnId,
    kind,
    openedAt,
  });

export const sessionWith = (id: string, patch: Partial<AgentSession> = {}) =>
  new AgentSession({
    id: SessionId.make(id),
    workspaceId: workspace.id,
    harness: session.harness,
    title: `Session ${id}`,
    cwd: session.cwd,
    worktreeId: null,
    state: "starting",
    permissionMode: "auto",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    contextUsage: null,
    lastError: null,
    createdAt: at,
    updatedAt: at,
    ...patch,
  });

export interface Seed {
  readonly session: AgentSession;
  readonly pending?: ReadonlyArray<ApprovalRequest>;
}

export const hostModel = (seeds: ReadonlyArray<Seed>): HostModel =>
  applyHostItems(emptyHostModel, [
    HostStreamItem.cases.Snapshot.make({
      sequence: seq(1),
      workspaces: [workspace],
      worktrees: [],
      sessions: seeds.map(
        (s) =>
          new SessionSummary({
            session: s.session,
            pendingApprovals: [...(s.pending ?? [])],
            lastTurnPreview: null,
            subagents: [],
          })
      ),
    }),
  ]);

export const host = (key: string, label: string): HostView => ({
  key,
  label,
  colour: null,
  alias: null,
  kind: "local",
  proofHarness: false,
  status: {
    state: "connected",
    failure: null,
    attempt: 0,
    since: 0,
    nextAttemptAt: null,
    host: null,
    capabilities: [],
    epoch: 0,
    latencyMs: null,
    lastSeenAt: null,
  },
});

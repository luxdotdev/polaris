import { expect, test } from "bun:test";
import { Schema } from "effect";
import {
  AgentSession,
  Workspace,
  WorktreeSetup,
  WorktreeSetupRun,
  DomainEvent,
  SessionId,
  WorkspaceId,
  ConstellationId,
  TaskId,
} from "./index.ts";

export const card = () =>
  WorktreeSetupRun.make({
    id: "setup",
    constellationId: ConstellationId.make("graph"),
    taskId: TaskId.make("A"),
    command: "bun install",
    cwd: "/repo/A",
    status: "failed",
    output: "install failed",
    exitCode: 1,
    startedAt: "2026-10-02T00:00:00.000Z",
    endedAt: "2026-10-02T00:00:01.000Z",
  });

test("old Workspace and Session payloads decode absent setup as null", () => {
  const workspace = Schema.decodeUnknownSync(Workspace)({
    id: "w",
    path: "/repo",
    name: "repo",
    isGitRepo: true,
    worktreeRoot: "/trees",
    hidden: false,
    registeredAt: "2026-10-02T00:00:00.000Z",
  });

  expect(workspace.worktreeSetup).toBeNull();

  const session = Schema.decodeUnknownSync(AgentSession)({
    id: "s",
    workspaceId: "w",
    harness: "codex",
    title: "test",
    cwd: "/repo",
    worktreeId: null,
    state: "dormant",
    permissionMode: "supervised",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    contextUsage: null,
    lastError: null,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  });

  expect(session.worktreeSetup).toBeNull();
});

test("setup fields and output survive wire codecs; whitespace commands are refused", () => {
  const event = DomainEvent.cases.SessionSetupChanged.make({
    sessionId: SessionId.make("s"),
    setup: card(),
  });

  const codec = Schema.fromJsonString(DomainEvent);
  expect(Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(event))).toEqual(event);
  expect(() =>
    Schema.decodeUnknownSync(Schema.fromJsonString(WorktreeSetup))(
      '{"_tag":"Command","command":"   "}'
    )
  ).toThrow();

  const workspace = new Workspace({
    id: WorkspaceId.make("w"),
    name: "repo",
    path: "/repo",
    isGitRepo: true,
    hidden: false,
    registeredAt: "2026-10-02T00:00:00.000Z",
    worktreeRoot: "/trees",
    worktreeSetup: WorktreeSetup.cases.Disabled.make({}),
  });

  expect(
    Schema.decodeUnknownSync(Schema.fromJsonString(Workspace))(
      Schema.encodeSync(Schema.fromJsonString(Workspace))(workspace)
    ).worktreeSetup
  ).toEqual(workspace.worktreeSetup);
});

test("old setup cards decode without a fingerprint; new cards retain it", () => {
  const { fingerprint: _, ...old } = Schema.encodeSync(WorktreeSetupRun)(card());
  expect(Schema.decodeUnknownSync(WorktreeSetupRun)(old).fingerprint).toBeNull();
  expect(
    Schema.decodeUnknownSync(WorktreeSetupRun)({ ...old, fingerprint: "sha256" }).fingerprint
  ).toBe("sha256");
});

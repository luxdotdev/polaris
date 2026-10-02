/**
 * Worktree setup in previews: B7's setup is running and B8's failed, both before their first
 * Attempt, on worker Sessions the Lead's Host lists.
 */
import { TaskId, WorktreeSetupRun } from "@polaris/protocol";
import type { SessionModel } from "../../../store/sessionModel.ts";
import type { ConstellationRecord } from "../model/index.ts";
import { B, c1Record, c1Tasks, CONSTELLATION, task, worker } from "./graph.ts";
import { session } from "./sessions.ts";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const WORKTREES = "/Users/lucas/code/polaris.worktrees/const-v1";

export const setupTasks = [
  task({ id: "B7", title: "Lease wrapper for the bench", group: B, deps: [] }),
  task({ id: "B8", title: "Desktop smoke on the bench path", group: B, deps: [], ui: true }),
];

const FAILED_OUTPUT = `bun install v1.3.13 (5c1ff3a2)
Resolving dependencies
error: GET https://registry.npmjs.org/@polaris%2fbench - 404
error: @polaris/bench@workspace:* failed to resolve
`;

export const setupRun = (
  taskId: string,
  status: WorktreeSetupRun["status"],
  minutes: number,
  exitCode: number | null = null
) =>
  new WorktreeSetupRun({
    id: `d-${taskId}:setup:1`,
    constellationId: CONSTELLATION,
    taskId: TaskId.make(taskId),
    command: "bun install",
    cwd: `${WORKTREES}/${taskId}`,
    status,
    output: status === "failed" ? FAILED_OUTPUT : "",
    exitCode,
    startedAt: ago(minutes),
    endedAt: status === "running" ? null : ago(minutes - 1),
  });

const setupSession = (taskId: string, title: string, run: WorktreeSetupRun) =>
  session(worker(taskId), {
    harness: taskId === "B8" ? "claude" : "codex",
    model: taskId === "B8" ? "opus" : "gpt-6.1-sol",
    title: `${taskId} · ${title}`,
    cwd: run.cwd,
    state: run.status === "failed" ? "failed" : "dormant",
    lastError:
      run.status === "failed"
        ? `Worktree setup failed: ${run.command}. Fix setup and dispatch again.`
        : null,
    turnCount: 0,
    contextUsage: null,
    worktreeSetup: run,
    createdAt: ago(4),
    updatedAt: ago(1),
  });

export const setupSessions = [
  setupSession("B7", "Lease wrapper for the bench", setupRun("B7", "running", 1)),
  setupSession("B8", "Desktop smoke on the bench path", setupRun("B8", "failed", 3, 1)),
];

/** B8's transcript: no Turn yet, only its setup card. */
export const b8Model = (): SessionModel => ({
  // SAFETY: preview sequences only need to be numbers.
  sequence: 12 as SessionModel["sequence"],
  synchronized: true,
  session: setupSessions[1] ?? null,
  pendingApprovals: [],
  turns: [],
});

export const setupRecord = (): ConstellationRecord =>
  c1Record({ tasks: [...c1Tasks, ...setupTasks] });

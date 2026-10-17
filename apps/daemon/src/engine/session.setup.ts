import { DomainEvent, WorktreeSetupRun } from "@polaris/protocol";
import type { SessionRecord } from "../store/model.ts";

/** Late completion cannot replace a newer setup or reopen an archived Session. */
export const setupChanged = (
  record: SessionRecord,
  setup: WorktreeSetupRun
): ReadonlyArray<DomainEvent> => {
  if (
    setup.status !== "running" &&
    (record.session.worktreeSetup?.id !== setup.id ||
      record.session.worktreeSetup.status !== "running")
  )
    return [];

  return [
    DomainEvent.cases.SessionSetupChanged.make({ sessionId: record.session.id, setup }),
    ...(setup.status === "failed" && record.session.state !== "archived"
      ? [
          DomainEvent.cases.SessionStateChanged.make({
            sessionId: record.session.id,
            state: "failed",
            reason: `Worktree setup failed: ${setup.command}. Fix setup and dispatch again.`,
          }),
        ]
      : []),
    ...(setup.status === "completed" &&
    record.session.state === "failed" &&
    record.session.lastError?.startsWith("Worktree setup failed:") === true
      ? [
          DomainEvent.cases.SessionStateChanged.make({
            sessionId: record.session.id,
            state: "dormant",
            reason: null,
          }),
        ]
      : []),
  ];
};

const INTERRUPTED = "Setup interrupted by Daemon";

/** A setup card that recovery failed because the Daemon stopped mid-run, not because setup failed. */
export const setupInterrupted = (setup: WorktreeSetupRun | null | undefined) =>
  setup?.status === "failed" &&
  setup.exitCode === null &&
  setup.output.split("\n").at(-1)?.startsWith(`${INTERRUPTED} `) === true;

/** Recovery leaves an unfinished setup as an actionable card, without inventing a Turn. */
export const interruptedSetup = (
  record: SessionRecord,
  at: string,
  cause: "restart" | "upgrade"
) => {
  const setup = record.session.worktreeSetup;

  if (setup?.status !== "running") return [];

  return setupChanged(
    record,
    new WorktreeSetupRun({
      id: setup.id,
      constellationId: setup.constellationId,
      taskId: setup.taskId,
      command: setup.command,
      cwd: setup.cwd,
      status: "failed",
      output: `${setup.output}\n${INTERRUPTED} ${cause}. Dispatch again to retry.`,
      exitCode: null,
      startedAt: setup.startedAt,
      endedAt: at,
    })
  );
};

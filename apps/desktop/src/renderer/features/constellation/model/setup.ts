/**
 * Worktree setup per Task: the latest setup run on any Host's worker Session for it, joined to
 * the graph by `constellationId` and `taskId` (setup fails before an Attempt exists).
 */
import {
  ConstellationId,
  HostId,
  type SessionId,
  TaskId,
  WorkerPlacement,
  type WorktreeSetupRun,
} from "@polaris/protocol";
import type { Plain } from "../../../store/plain.ts";
import type { AttemptData } from "./types.ts";

export type SetupRun = Plain<WorktreeSetupRun>;

export interface SetupFact {
  readonly run: SetupRun;
  /** The worker Session that ran it, and its Host. */
  readonly hostKey: string;
  readonly hostId: string;
  readonly sessionId: SessionId;
  /** The Host's label when it isn't the Lead's. */
  readonly remoteHost: string | null;
  /** The Session is still failed because of this run, not a later Harness error. */
  readonly failed: boolean;
}

export interface SetupSession {
  readonly id: SessionId;
  readonly state: string;
  readonly lastError: string | null;
  readonly worktreeSetup?: SetupRun | null;
}

export interface SetupSource {
  readonly hostKey: string;
  readonly hostId: string;
  readonly hostLabel: string;
  readonly sessions: Iterable<SetupSession>;
}

interface HostLike {
  readonly key: string;
  readonly label: string;
  readonly status: { readonly host: { readonly hostId: string } | null };
}

interface HostModelLike {
  readonly sessions: ReadonlyMap<string, { readonly session: SetupSession }>;
}

function* summaries(entries: Iterable<{ readonly session: SetupSession }>) {
  for (const entry of entries) yield entry.session;
}

/** Every Host's Session summaries; it runs on each store change, so it copies nothing. */
export function* setupSources(
  hosts: ReadonlyArray<HostLike>,
  models: Readonly<Record<string, HostModelLike | undefined>>
): Generator<SetupSource> {
  for (const host of hosts) {
    const model = models[host.key];
    const hostId = host.status.host?.hostId;

    if (model !== undefined && hostId !== undefined)
      yield {
        hostKey: host.key,
        hostId,
        hostLabel: host.label,
        sessions: summaries(model.sessions.values()),
      };
  }
}

const SETUP_ERROR = "Worktree setup failed:";

/** The Daemon's current-failure predicate (engine G2). */
export const isSetupFailure = (session: SetupSession) =>
  session.state === "failed" &&
  session.worktreeSetup?.status === "failed" &&
  session.lastError?.startsWith(SETUP_ERROR) === true;

/** Each Task's latest setup run in one Constellation, across every Host; archived ones are history. */
export const setupsOf = (
  sources: Iterable<SetupSource>,
  constellationId: string,
  leadHostId: string
): ReadonlyMap<string, SetupFact> => {
  const byTask = new Map<string, SetupFact>();

  for (const source of sources) {
    for (const session of source.sessions) {
      const run = session.worktreeSetup;

      if (run == null || run.constellationId !== constellationId || session.state === "archived")
        continue;
      const prior = byTask.get(run.taskId);

      if (prior !== undefined && prior.run.startedAt >= run.startedAt) continue;
      byTask.set(run.taskId, {
        run,
        hostKey: source.hostKey,
        hostId: source.hostId,
        sessionId: session.id,
        remoteHost: source.hostId === leadHostId ? null : source.hostLabel,
        failed: isSetupFailure(session),
      });
    }
  }

  return byTask;
};

/**
 * The setup that decides a Task's row: running, or failed and still current, and newer than
 * its latest Attempt (an Attempt starts only after its setup completes).
 */
export const currentSetup = (
  setup: SetupFact | null,
  attempt: Pick<AttemptData, "startedAt"> | null
): SetupFact | null => {
  if (setup === null || (setup.run.status !== "running" && !setup.failed)) return null;

  return attempt === null || setup.run.startedAt > attempt.startedAt ? setup : null;
};

/** "exited 1"; a run that never exited (launch error, restart) "didn't finish". */
export const setupExit = (run: Pick<SetupRun, "exitCode">) =>
  run.exitCode === null ? "didn't finish" : `exited ${run.exitCode}`;

/** "bun install exited 1". */
export const setupOutcome = (run: SetupRun) => `${run.command} ${setupExit(run)}`;

/**
 * Dispatches the Task again after its setup failed: on the Lead's Host the same worker Session
 * (setup reruns in its checkout and repairs it), elsewhere a new worker on the same Host.
 */
export const retrySetup = (setup: SetupFact, leadHostId: string) => ({
  constellationId: ConstellationId.make(setup.run.constellationId),
  tasks: [
    {
      taskId: TaskId.make(setup.run.taskId),
      worker:
        setup.hostId === leadHostId
          ? WorkerPlacement.cases.Existing.make({ sessionId: setup.sessionId })
          : WorkerPlacement.cases.New.make({ hostId: HostId.make(setup.hostId) }),
    },
  ],
  defaultWorker: null,
});

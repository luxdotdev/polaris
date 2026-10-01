/**
 * Accepting an Agent Session's work, one step after another (ENG-224): accept the Turns,
 * commit them, push, open the pull request as the routed GitHub account, link it to the
 * session. Pure over its ports, so it's tested without a Daemon or GitHub. A failed run
 * resumes from the step that failed with what the earlier steps produced.
 */
import type { AcceptBranch, CommitGranularity, SessionId, TurnId } from "@polaris/protocol";
import type { IpcError } from "../../../../shared/api.ts";
import type { RepoRef, WorkspaceRef } from "../../../../shared/github.ts";

export type AcceptStep = "accept" | "commit" | "push" | "pull" | "link";

export const STEP_LABELS: Readonly<Record<AcceptStep, string>> = {
  accept: "Accepting turns",
  commit: "Committing",
  push: "Pushing",
  pull: "Opening the pull request",
  link: "Linking the pull request",
};

export interface PullDraft {
  readonly repo: RepoRef;
  readonly workspace: WorkspaceRef;
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
}

export interface AcceptRequest {
  readonly sessionId: SessionId;
  readonly throughTurnId: TurnId;
  readonly revertLaterTurns: boolean;
  readonly branch: AcceptBranch;
  readonly granularity: CommitGranularity;
  readonly title: string;
  readonly body: string;
  readonly turnTitles: ReadonlyArray<string>;
  /** Push after committing (there is a remote). */
  readonly push: boolean;
  /** Open a pull request after pushing; null when the session has one or it can't have one. */
  readonly pull: PullDraft | null;
}

export type Answer<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: IpcError };

export interface OpenedPull {
  readonly number: number;
  readonly url: string;
}

/** What the run needs from the Daemon and GitHub. */
export interface AcceptPorts {
  readonly accept: (request: AcceptRequest) => Promise<Answer<null>>;
  readonly commit: (request: AcceptRequest) => Promise<
    Answer<{
      readonly branch: string;
      readonly commits: ReadonlyArray<string>;
      readonly base: string | null;
    }>
  >;
  readonly push: (sessionId: SessionId, branch: string) => Promise<Answer<null>>;
  readonly openPull: (pull: PullDraft, head: string, base: string) => Promise<Answer<OpenedPull>>;
  readonly link: (sessionId: SessionId, repo: RepoRef, pull: OpenedPull) => Promise<Answer<null>>;
}

/** What the steps so far produced; a resumed run carries it over. */
export interface AcceptProgress {
  readonly done: ReadonlyArray<AcceptStep>;
  readonly branch: string | null;
  readonly base: string | null;
  readonly commits: ReadonlyArray<string>;
  readonly pull: OpenedPull | null;
}

export const NO_PROGRESS: AcceptProgress = {
  done: [],
  branch: null,
  base: null,
  commits: [],
  pull: null,
};

export type AcceptOutcome =
  | { readonly ok: true; readonly progress: AcceptProgress }
  | {
      readonly ok: false;
      readonly step: AcceptStep;
      readonly message: string;
      readonly progress: AcceptProgress;
    };

/** The steps this request takes, in order. */
export const stepsOf = (request: AcceptRequest): ReadonlyArray<AcceptStep> => [
  "accept",
  "commit",
  ...(request.push ? (["push"] as const) : []),
  ...(request.push && request.pull !== null ? (["pull", "link"] as const) : []),
];

type StepRun = (progress: AcceptProgress) => Promise<Answer<Partial<AcceptProgress>>>;

const stepRuns = (request: AcceptRequest, ports: AcceptPorts): Record<AcceptStep, StepRun> => {
  const after = async <A>(
    answer: Promise<Answer<A>>,
    patch: (value: A) => Partial<AcceptProgress>
  ): Promise<Answer<Partial<AcceptProgress>>> => {
    const result = await answer;

    return result.ok ? { ok: true, value: patch(result.value) } : result;
  };

  return {
    accept: () => after(ports.accept(request), () => ({})),
    commit: () =>
      after(ports.commit(request), (c) => ({ branch: c.branch, base: c.base, commits: c.commits })),
    push: (p) => after(ports.push(request.sessionId, p.branch ?? ""), () => ({})),
    pull: async (p) => {
      if (request.pull === null || p.base === null || p.branch === null) {
        return { ok: true, value: {} };
      }

      return after(ports.openPull(request.pull, p.branch, p.base), (pull) => ({ pull }));
    },
    link: (p) =>
      request.pull === null || p.pull === null
        ? Promise.resolve({ ok: true, value: {} })
        : after(ports.link(request.sessionId, request.pull.repo, p.pull), () => ({})),
  };
};

/** Runs the steps not yet done, reporting each as it starts; stops at the first failure. */
export const runAccept = async (
  request: AcceptRequest,
  ports: AcceptPorts,
  onStep: (step: AcceptStep) => void,
  from: AcceptProgress = NO_PROGRESS
): Promise<AcceptOutcome> => {
  const runs = stepRuns(request, ports);
  const done = [...from.done];
  const progress = { ...from, done };

  for (const step of stepsOf(request)) {
    if (done.includes(step)) continue;
    onStep(step);
    const result = await runs[step](progress);

    if (!result.ok) return { ok: false, step, message: result.error.message, progress };
    Object.assign(progress, result.value);
    done.push(step);
  }

  return { ok: true, progress };
};

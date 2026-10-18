/**
 * How an interrupted fiber stops the git it started (docs/adr/0071). Work run through
 * `interruptibleGit` or `finishingGit` carries an AbortSignal that every git spawn
 * under it reads; an interrupt aborts it, git and its tree are ended, and the Effect
 * completes only once git has exited, so its repository is free again.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { Effect } from "effect";
import { killTree, ownProcessGroup } from "../platform/processes.ts";

const ambient = new AsyncLocalStorage<AbortSignal>();

/** After SIGTERM, how long git has to clean up its lock files before SIGKILL. */
export const KILL_GRACE_MS = 2_000;

/** How long an interrupted write may run on before it is killed. */
export const FINISH_MS = 5_000;

/** How long an interrupt waits for killed git to exit (a lost exit must not hang shutdown). */
const EXIT_WAIT_MS = KILL_GRACE_MS + 3_000;

/** The git call was interrupted before it started; nothing was run. */
export class GitInterrupted extends Error {
  constructor(readonly args: ReadonlyArray<string>) {
    super(`git ${args.join(" ")} was not started: its work was interrupted`);
  }
}

/** The signal of the git work this call runs in, joined with the caller's own. */
export const interruptSignal = (own?: AbortSignal): AbortSignal | undefined => {
  const outer = ambient.getStore();

  if (outer === undefined || own === undefined) return outer ?? own;

  return AbortSignal.any([outer, own]);
};

/** The signal a git about to start runs under; throws `GitInterrupted` once it has aborted. */
export const startSignal = (args: ReadonlyArray<string>, own?: AbortSignal) => {
  const signal = interruptSignal(own);

  if (signal?.aborted === true) throw new GitInterrupted(args);

  return signal;
};

/** Runs `run` with its git ended when `signal` aborts: work a stream starts from a timer. */
export const underSignal = <A>(signal: AbortSignal, run: () => Promise<A>): Promise<A> =>
  ambient.run(signal, run);

/**
 * Runs `run` out of reach of any interrupt: the cleanup a killed write needs (`merge --abort`),
 * and a cache's fill, which other callers share.
 */
export const uninterrupted = <A>(run: () => A): A => ambient.exit(run);

/** Spawn options so a kill reaches what git started (ssh, a hook, a credential helper). */
export const groupFor = (signal: AbortSignal | undefined): { detached?: true } =>
  signal !== undefined && ownProcessGroup() ? { detached: true } : {};

interface Child {
  readonly pid: number;
  readonly exited: Promise<number>;
  readonly kill: (signal?: NodeJS.Signals) => void;
}

/**
 * Ends `child` and its tree once `signal` aborts: SIGTERM to its group (git removes
 * its lock files), SIGKILL after `KILL_GRACE_MS`. On Windows both are `taskkill /T /F`.
 */
export const stopOnAbort = (child: Child, signal: AbortSignal | undefined): void => {
  if (signal === undefined) return;
  let exited = false;

  const stop = () => {
    void killTree(child.pid, "SIGTERM");

    const hard = setTimeout(() => {
      if (exited) return;
      void killTree(child.pid, "SIGKILL");
      child.kill("SIGKILL");
    }, KILL_GRACE_MS);

    void child.exited.then(() => clearTimeout(hard));
  };

  signal.addEventListener("abort", stop, { once: true });

  if (signal.aborted) stop();
  void child.exited.then(() => {
    exited = true;
    signal.removeEventListener("abort", stop);
  });
};

/** How long a killed git's pipes are read after it exits. */
const PIPE_GRACE_MS = 1_000;

/**
 * `reads` of a git's pipes; once `signal` has aborted and git exited, `killed` after a moment:
 * a grandchild that outlived the kill (an MSYS `sleep` on Windows) can hold them open.
 */
export const pipesOf = async <A>(
  reads: Promise<A>,
  exited: Promise<number>,
  signal: AbortSignal | undefined,
  killed: A
): Promise<A> => {
  if (signal === undefined) return reads;
  await exited;

  if (!signal.aborted) return reads;

  return Promise.race([reads, Bun.sleep(PIPE_GRACE_MS).then(() => killed)]);
};

const settled = (done: Promise<unknown>, ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);

    void done.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });

interface GitWork<A, E> {
  /** Its signal is the one its git reads, for work of its own that should stop too. */
  readonly try: (signal: AbortSignal) => Promise<A>;
  readonly catch: (cause: unknown) => E;
}

const work = <A, E>(options: GitWork<A, E>, finishMs: number) =>
  Effect.callback<A, E>((resume) => {
    const controller = new AbortController();

    const done = ambient
      .run(controller.signal, async () => options.try(controller.signal))
      .then(
        (value) => resume(Effect.succeed(value)),
        (cause: unknown) => resume(Effect.suspend(() => Effect.fail(options.catch(cause))))
      );

    return Effect.promise(async () => {
      if (finishMs > 0) await settled(done, finishMs);
      controller.abort();
      await settled(done, EXIT_WAIT_MS);
    });
  });

/** Read-only git work: an interrupt kills its git at once and waits for it to exit. */
export const interruptibleGit = <A, E>(options: GitWork<A, E>): Effect.Effect<A, E> =>
  work(options, 0);

/** `interruptibleGit` for work whose failure is a defect, as `Effect.promise`'s is. */
export const interruptibleGitPromise = <A>(run: () => Promise<A>): Effect.Effect<A> =>
  Effect.orDie(work({ try: run, catch: (cause) => cause }, 0));

/**
 * Git work that writes refs, the index or a work tree: an interrupt lets it finish for
 * up to `finishMs`, then kills it; a git it hasn't started yet never starts.
 */
export const finishingGit = <A, E>(
  options: GitWork<A, E>,
  finishMs: number = FINISH_MS
): Effect.Effect<A, E> => work(options, finishMs);

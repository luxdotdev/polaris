/**
 * The Windows service step of `polaris install` / `uninstall`: register the
 * Task Scheduler task (`windowsTask.ts`), and stop and start the Daemon through
 * its control pipe (`windowsControl.ts`). Windows has no hand-off, so a new
 * binary means stop the old Daemon, then start the task on `current` (ADR 0060).
 * A task that runs another Polaris home is never replaced or deleted unasked.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect, Match } from "effect";
import { CommandRunner } from "./CommandRunner.ts";
import { InstallError, TaskConflictError } from "./errors.ts";
import type { ControlAnswer, ControlReply, ControlRequest } from "./windowsControl.ts";
import {
  claimTask,
  type ExistingTask,
  type TaskClaim,
  taskWorkingDirectory,
} from "./windowsTask.ts";

export interface WindowsTaskFacts {
  /** `schtasks /Query` found the task. */
  readonly registered: boolean;
  readonly changed: { readonly binary: boolean; readonly serviceFile: boolean };
  /** The Daemon answering on the control pipe, if any. */
  readonly running: ControlReply | null;
  /** The version being installed. */
  readonly version: string;
}

export interface WindowsTaskPlan {
  readonly register: boolean;
  /** Stop the running Daemon first, recording this reason; null to leave it. */
  readonly stop: "upgrade" | "restart" | null;
  /** Run the task and wait for `version` to answer. */
  readonly start: boolean;
}

/** Pure: what an install does to the task and the running Daemon. */
export const planWindowsTask = (facts: WindowsTaskFacts): WindowsTaskPlan => {
  const register = !facts.registered || facts.changed.serviceFile;

  if (facts.running === null) return { register, stop: null, start: true };
  const otherVersion = facts.running.version !== facts.version;

  if (otherVersion || facts.changed.binary) return { register, stop: "upgrade", start: true };

  // A new task definition only applies to a loop started from it.
  if (register) return { register, stop: "restart", start: true };

  return { register, stop: null, start: false };
};

/** How long to wait for a stopped Daemon to exit: its shutdown grace plus a margin. */
const STOP_WAIT_MS = 20_000;

/** How long to wait for the task's Daemon to answer after `schtasks /Run`. */
const START_WAIT_MS = 30_000;

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

const ask = (home: string, request: ControlRequest) =>
  Effect.promise(async (): Promise<ControlAnswer> => {
    const control = await import("./windowsControl.ts");

    return control.askDaemon(home, request);
  });

const refuseForeign = (answer: ControlAnswer) =>
  answer.kind === "foreign"
    ? Effect.fail(
        new InstallError({
          step: "control pipe",
          message: "another account created this Polaris home's control pipe; not talking to it",
        })
      )
    : Effect.void;

/** The Daemon answering for `home` right now, or null. */
export const runningDaemon = Effect.fnUntraced(function* (home: string) {
  const answer = yield* ask(home, { op: "status" });
  yield* refuseForeign(answer);

  return answer.kind === "reply" ? answer.reply : null;
});

/** Asks the Daemon to stop (it exits 76, so the task's loop ends too) and waits for it to go. */
export const stopDaemon = Effect.fnUntraced(function* (home: string, reason: string) {
  const answer = yield* ask(home, { op: "stop", reason });
  yield* refuseForeign(answer);

  if (answer.kind !== "reply") return null;
  const { pid } = answer.reply;
  const deadline = Date.now() + STOP_WAIT_MS;

  while (isAlive(pid)) {
    if (Date.now() >= deadline) {
      return yield* new InstallError({
        step: "stop Daemon",
        message: `the Daemon (PID ${pid}) did not exit within ${STOP_WAIT_MS / 1000} s`,
      });
    }

    yield* Effect.sleep(100);
  }

  return pid;
});

const schtasks = Effect.fnUntraced(function* (...args: Array<string>) {
  const runner = yield* CommandRunner;

  return yield* runner.run(["schtasks", ...args]);
});

/** The registered task's definition (`schtasks` prints it as UTF-8), or null when there is none. */
export const queryTaskXml = Effect.fnUntraced(function* (name: string) {
  const result = yield* schtasks("/Query", "/TN", name, "/XML");

  return result.code === 0 ? result.stdout : null;
});

export const registerTask = Effect.fnUntraced(function* (name: string, xmlFile: string) {
  const result = yield* schtasks("/Create", "/F", "/TN", name, "/XML", xmlFile);

  if (result.code !== 0) {
    return yield* new InstallError({
      step: "register task",
      message: `schtasks /Create exited ${result.code}: ${(result.stderr || result.stdout).trim()}`,
    });
  }
});

/**
 * Runs the task until `version` answers. A loop that is still ending makes
 * Task Scheduler ignore a run (one instance at a time), so it asks again.
 */
export const startTask = Effect.fnUntraced(function* (name: string, home: string, version: string) {
  const deadline = Date.now() + START_WAIT_MS;
  let lastRun = 0;

  while (Date.now() < deadline) {
    if (Date.now() - lastRun >= 2000) {
      lastRun = Date.now();
      yield* schtasks("/Run", "/TN", name);
    }

    const running = yield* runningDaemon(home);

    if (running?.version === version) return running;
    yield* Effect.sleep(250);
  }

  return yield* new InstallError({
    step: "start task",
    message: `polaris ${version} did not start within ${START_WAIT_MS / 1000} s; see ${home}\\logs\\daemon.err.log. The task runs only while you are signed in to Windows.`,
  });
});

export const deleteTask = Effect.fnUntraced(function* (name: string) {
  return (yield* schtasks("/Delete", "/F", "/TN", name)).code === 0;
});

/** The task registered under `name`: the home it runs, and whether that home is still installed. */
export const inspectTask = Effect.fnUntraced(function* (name: string) {
  const xml = yield* queryTaskXml(name);

  if (xml === null) return null;
  const home = taskWorkingDirectory(xml);
  const homeInstalled = home !== null && existsSync(join(home, "bin", "current", "polaris.exe"));

  return { home, homeInstalled } satisfies ExistingTask;
});

/** One home's task: its name, the home, and the definition file `schtasks /XML` reads. */
export interface WindowsTaskTarget {
  readonly task: string;
  readonly home: string;
  readonly definition: string;
}

const claimNote = (claim: TaskClaim, otherHome: string | null): ReadonlyArray<string> =>
  Match.value(claim).pipe(
    Match.when("abandoned", () => [
      `The task ran ${otherHome}, which has nothing installed; it runs this home now.`,
    ]),
    Match.when("taken-over", () => [
      `The task ran ${otherHome ?? "something else"}; it runs this home now, as --replace-task asked.`,
    ]),
    Match.orElse(() => [])
  );

/**
 * Windows: register the task (never over another live home's, unless `replace`), stop
 * a Daemon running another binary (Windows has no hand-off; its terminals end), then
 * run the task until `version` answers.
 */
export const activateWindowsTask = Effect.fnUntraced(function* (
  target: WindowsTaskTarget,
  changed: { readonly binary: boolean; readonly serviceFile: boolean },
  version: string,
  replace: boolean
) {
  const existing = yield* inspectTask(target.task);
  const claim = claimTask(existing, target.home, replace);
  const otherHome = existing?.home ?? null;

  if (claim === "conflict")
    return yield* new TaskConflictError({ task: target.task, home: target.home, otherHome });

  // The other home's loop must end first: one instance at a time, so it would block ours.
  if (claim === "taken-over" && otherHome !== null) yield* stopDaemon(otherHome, "restart");

  const plan = planWindowsTask({
    registered: claim === "ours",
    changed,
    running: yield* runningDaemon(target.home),
    version,
  });

  if (plan.register) yield* registerTask(target.task, target.definition);

  if (plan.stop !== null) yield* stopDaemon(target.home, plan.stop);

  if (plan.start) yield* startTask(target.task, target.home, version);

  const stopped =
    plan.stop === null
      ? []
      : ["The previous Daemon was stopped: its terminals ended, and Agent Sessions resume."];

  return {
    domain: `task-scheduler ${target.task}`,
    restarted: plan.stop !== null,
    linger: "not-applicable" as const,
    notes: [...claimNote(claim, otherHome), ...stopped],
  };
});

/**
 * Windows: stop this home's Daemon (its exit ends the task's loop) and delete the task,
 * only if it runs this home. Returns whether a Daemon stopped and the task left alone.
 */
export const removeWindowsTask = Effect.fnUntraced(function* (target: WindowsTaskTarget) {
  const stopped = yield* stopDaemon(target.home, "uninstall");
  const existing = yield* inspectTask(target.task);
  const ours = claimTask(existing, target.home, false) === "ours";

  if (ours) yield* deleteTask(target.task);

  return { stopped: stopped !== null, keptTask: existing !== null && !ours ? target.task : null };
});

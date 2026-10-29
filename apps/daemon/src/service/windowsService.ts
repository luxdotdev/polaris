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
import { encodePowershell, powershellQuote } from "../platform/processes.ts";
import { CommandRunner } from "./CommandRunner.ts";
import { InstallError, TaskConflictError } from "./errors.ts";
import type { ControlAnswer, ControlReply, ControlRequest } from "./windowsControl.ts";
import {
  claimTask,
  describeTask,
  type ExistingTask,
  isOwnClaim,
  readTask,
  stopsOtherHome,
  taskAction,
  type TaskClaim,
  UNREADABLE_TASK,
} from "./windowsTask.ts";

export interface WindowsTaskFacts {
  /** `schtasks /Query` found the task. */
  readonly registered: boolean;
  readonly changed: { readonly binary: boolean; readonly serviceFile: boolean };
  /** The Daemon answering on the control pipe, if any. */
  readonly running: ControlReply | null;
  /** The version being installed. */
  readonly version: string;
  /** `install --restart`: stop and start the running Daemon even when nothing changed. */
  readonly restart?: boolean;
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
  if (register || facts.restart === true) return { register, stop: "restart", start: true };

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

/** Task Scheduler's `TASK_STATE_RUNNING`: an instance of the task is running now. */
const TASK_STATE_RUNNING = 4;

/** How long a Task Scheduler query may take: PowerShell can stall (CI runners); past this it can't say. */
const TASK_SCHEDULER_QUERY_MS = 5000;

/** A script on Task Scheduler's COM API: numbers and HRESULTs, where `schtasks` prints localized words. */
const taskSchedulerScript = Effect.fnUntraced(function* (body: string) {
  const runner = yield* CommandRunner;
  const script = `$s = New-Object -ComObject Schedule.Service; $s.Connect(); ${body}`;

  return yield* runner.run(
    ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"].concat(
      encodePowershell(script)
    ),
    { timeoutMs: TASK_SCHEDULER_QUERY_MS }
  );
});

/** Whether an instance of the task `name` runs now; null when Task Scheduler couldn't say. */
export const taskRunning = Effect.fnUntraced(function* (name: string) {
  const result = yield* taskSchedulerScript(
    `[int]$s.GetFolder('\\').GetTask(${powershellQuote(name)}).State`
  );

  const state = /^\s*(\d+)\s*$/.exec(result.stdout)?.[1];

  return result.code !== 0 || state === undefined ? null : Number(state) === TASK_STATE_RUNNING;
});

/** `E_ACCESSDENIED`: a task has the name, but this user may not read it. */
const ACCESS_DENIED = "80070005";

/**
 * Why `schtasks /Query` found no task: `unreadable` when Task Scheduler denies this user a
 * task under the name (another account's), else `absent`, also when it can't say.
 */
export const missingTaskReason = Effect.fnUntraced(function* (name: string) {
  const result = yield* taskSchedulerScript(
    `try { $null = $s.GetFolder('\\').GetTask(${powershellQuote(name)}); 'readable' } catch { '{0:X8}' -f $_.Exception.HResult }`
  );

  return result.stdout.trim().toUpperCase() === ACCESS_DENIED
    ? ("unreadable" as const)
    : ("absent" as const);
});

/** One home's task: its name, the home, the definition file `schtasks /XML` reads, and its principal. */
export interface WindowsTaskTarget {
  readonly task: string;
  readonly home: string;
  readonly definition: string;
  /** This user's SID, from the process token: the principal `taskXml` registers. */
  readonly userSid: string;
  /** `%SystemRoot%`, where the action's conhost.exe and cmd.exe live. */
  readonly systemRoot: string;
}

/**
 * The task registered under the target's name: whose and what it runs. Its working
 * directory is touched only when it is this user's Polaris task on a local drive.
 */
export const inspectTask = Effect.fnUntraced(function* (target: WindowsTaskTarget) {
  const xml = yield* queryTaskXml(target.task);

  if (xml === null)
    return (yield* missingTaskReason(target.task)) === "absent" ? null : UNREADABLE_TASK;

  const seen = describeTask(readTask(xml), target.userSid, taskAction(target.systemRoot));

  const homeInstalled =
    seen.home !== null && existsSync(join(seen.home, "bin", "current", "polaris.exe"));

  return { ...seen, homeInstalled } satisfies ExistingTask;
});

const claimNote = (
  claim: TaskClaim,
  otherHome: string | null,
  stoppedOther: boolean
): ReadonlyArray<string> =>
  Match.value(claim).pipe(
    Match.when("stale", () => ["The task had an older definition; it was registered again."]),
    Match.when("abandoned", () => [
      `The task ran ${otherHome}, which has nothing installed; it runs this home now.`,
    ]),
    Match.when("taken-over", () => [
      `The task ran ${otherHome ?? "something else"}; it runs this home now, as --replace-task asked.`,
      stoppedOther
        ? `The Daemon the task ran for ${otherHome} was stopped.`
        : "The task wasn't running, so no other Daemon was stopped.",
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
  replace: boolean,
  restart: boolean = false
) {
  const existing = yield* inspectTask(target);
  const claim = claimTask(existing, target.home, replace);
  const otherHome = existing?.home ?? null;

  if (claim === "conflict")
    return yield* new TaskConflictError({ task: target.task, home: target.home, otherHome });

  // The other home's loop must end first: one instance at a time, so it would block ours.
  const stopOther =
    claim === "taken-over" && stopsOtherHome(claim, otherHome, yield* taskRunning(target.task));

  if (stopOther && otherHome !== null) yield* stopDaemon(otherHome, "restart");

  const plan = planWindowsTask({
    registered: claim === "ours",
    changed,
    running: yield* runningDaemon(target.home),
    version,
    restart,
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
    notes: [...claimNote(claim, otherHome, stopOther), ...stopped],
  };
});

/**
 * Windows: stop this home's Daemon (its exit ends the task's loop) and delete the task,
 * only if it is this user's task for this home. Returns whether a Daemon stopped and the task left alone.
 */
export const removeWindowsTask = Effect.fnUntraced(function* (target: WindowsTaskTarget) {
  const stopped = yield* stopDaemon(target.home, "uninstall");
  const existing = yield* inspectTask(target);
  const ours = isOwnClaim(claimTask(existing, target.home, false));

  if (ours) yield* deleteTask(target.task);

  return { stopped: stopped !== null, keptTask: existing !== null && !ours ? target.task : null };
});

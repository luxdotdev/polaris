/**
 * The Windows service step of `polaris install` / `uninstall`: register the
 * Task Scheduler task (`windowsTask.ts`), and stop and start the Daemon through
 * its control pipe (`windowsControl.ts`). Windows has no hand-off, so a new
 * binary means stop the old Daemon, then start the task on `current` (ADR 0060).
 */
import { Effect } from "effect";
import { CommandRunner } from "./CommandRunner.ts";
import { InstallError } from "./errors.ts";
import type { ControlAnswer, ControlReply, ControlRequest } from "./windowsControl.ts";

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

export const isTaskRegistered = Effect.fnUntraced(function* (name: string) {
  return (yield* schtasks("/Query", "/TN", name)).code === 0;
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

/**
 * Bun's `node:child_process` can lose a child's exit under load (ENG-356, ENG-357): the
 * child is gone but `exit` never fires. These helpers notice that from the outside.
 */
import { Schema } from "effect";
import { processIdentity } from "./process.ts";

/** `process.kill(pid, 0)`'s error when no such process exists. */
const isMissing = Schema.is(Schema.Struct({ code: Schema.Literal("ESRCH") }));

/**
 * Whether `pid` no longer runs the process that had `identity`: gone, a zombie, or reused.
 * Without `identity`, only gone or a zombie counts. A `ps` that never answers counts as running.
 */
export const processGone = async (pid: number, identity?: string): Promise<boolean> => {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return isMissing(error);
  }

  const current = await processIdentity(pid).catch(() => undefined);

  if (current === undefined) return false;

  return identity === undefined ? current === null : current !== identity;
};

export interface LostExitWatch {
  readonly stop: () => void;
}

export interface LostExitOptions {
  readonly intervalMs?: number;
  readonly gone?: (pid: number) => Promise<boolean>;
}

/**
 * Checks `pid` every `intervalMs` until it's gone, then calls `onLost` once. It runs only
 * between a caller's start and `stop`, so it can't wake an idle Daemon.
 */
export const watchLostExit = (
  pid: number,
  onLost: () => void,
  { intervalMs = 1000, gone = processGone }: LostExitOptions = {}
): LostExitWatch => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    timer = setTimeout(() => void tick(), intervalMs);
  };

  const tick = async () => {
    if (stopped) return;
    const lost = await gone(pid).catch(() => false);

    if (stopped) return;

    if (!lost) {
      schedule();

      return;
    }

    stopped = true;
    onLost();
  };

  schedule();

  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
};

/** What `guardExit` needs of a `node:child_process` child. */
export interface ExitingChild {
  readonly pid?: number | undefined;
  readonly stdout: { once: (event: "close", listener: () => void) => void } | null;
  once(event: "exit", listener: () => void): void;
  emit(event: "exit", code: null, signal: null): boolean;
}

/**
 * Once the child's stdout closes it is exiting, so from then on a lost exit is detected and
 * `exit` is emitted with no code. A running child is never polled.
 */
export const guardExit = <C extends ExitingChild>(child: C, options: LostExitOptions = {}): C => {
  let exited = false;
  let watch: LostExitWatch | undefined;

  child.once("exit", () => {
    exited = true;
    watch?.stop();
  });

  child.stdout?.once("close", () => {
    const pid = child.pid;

    if (exited || pid === undefined) return;
    watch = watchLostExit(
      pid,
      () => {
        if (!exited) child.emit("exit", null, null);
      },
      options
    );
  });

  return child;
};

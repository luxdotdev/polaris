/**
 * Single-instance guard for the Daemon: one per user per Host.
 *
 * The lock file holds the owner's pid and when that process started (see
 * `processStart.ts`), and is created with O_EXCL, so two Daemons can't both
 * create it. A lock is stale, and taken over, when its pid is no longer alive
 * or now belongs to a process that started later: the pid was reused, as
 * after a reboot. A lock without a start time (written by an older Daemon) is
 * checked against its mtime instead. Where the start can't be read (Windows),
 * a live pid keeps the lock.
 *
 * The socket probe in `socket.ts` runs only once the lock is held: it stops a
 * second Daemon when the lock file was deleted by hand.
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { Effect, Schema, type Scope } from "effect";
import { processStart } from "./processStart.ts";

export class DaemonAlreadyRunning extends Schema.TaggedError<DaemonAlreadyRunning>()(
  "DaemonAlreadyRunning",
  {
    pid: Schema.NullOr(Schema.Int),
    path: Schema.String,
  }
) {
  override get message() {
    return this.pid === null
      ? `a Daemon is already listening on ${this.path}`
      : `a Daemon is already running (pid ${this.pid}, lock ${this.path})`;
  }
}

export class LockError extends Schema.TaggedError<LockError>()("LockError", {
  path: Schema.String,
  message: Schema.String,
}) {}

/** A Node system error, which carries its errno name in `code`. */
const isErrno = Schema.is(Schema.Struct({ code: Schema.String }));

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return isErrno(error) && error.code === "EPERM";
  }
};

/** A lock file's contents: the pid on the first line, its process start identity on the second. */
interface Holder {
  readonly pid: number | null;
  readonly identity: string | null;
}

const readHolder = (path: string): Holder => {
  try {
    const [first = "", second = ""] = readFileSync(path, "utf8").split("\n");
    const pid = Number.parseInt(first.trim(), 10);

    return {
      pid: Number.isInteger(pid) && pid > 0 ? pid : null,
      identity: second.trim() === "" ? null : second.trim(),
    };
  } catch {
    return { pid: null, identity: null };
  }
};

const readPid = (path: string): number | null => readHolder(path).pid;

/** Slack for a lock written in the same second its process started (ps reports whole seconds). */
const START_SLACK_MS = 2000;

/** True when live process `pid` is the one that wrote the lock, or when that can't be told. */
const isHolder = (path: string, holder: Holder & { pid: number }): boolean => {
  const actual = processStart(holder.pid);

  if (actual === null) return true;

  if (holder.identity !== null) return holder.identity === actual.identity;

  try {
    return actual.startedAt <= statSync(path).mtimeMs + START_SLACK_MS;
  } catch {
    return true;
  }
};

const isFresh = (path: string): boolean => {
  try {
    return Date.now() - statSync(path).mtimeMs < 2000;
  } catch {
    return false;
  }
};

const tryCreate = (path: string, identity: string): boolean => {
  try {
    const fd = openSync(path, "wx", 0o600);

    try {
      writeSync(fd, `${process.pid}\n${identity}\n`);
    } finally {
      closeSync(fd);
    }

    return true;
  } catch (error) {
    if (isErrno(error) && error.code === "EEXIST") return false;
    throw error;
  }
};

/** Lock files this process holds right now. */
const held = new Set<string>();

/** `-1` stands for a holder that hasn't written its pid yet. */
type Claim = "acquired" | number;

const removeStale = (path: string) => {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!isErrno(error) || error.code !== "ENOENT") throw error;
  }
};

const claim = (path: string): Claim => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const identity = processStart(process.pid)?.identity ?? "";

  for (let attempt = 0; attempt < 3; attempt++) {
    if (tryCreate(path, identity)) return "acquired";
    const holder = readHolder(path);
    const { pid } = holder;

    if (pid === process.pid) return held.has(path) ? pid : "acquired";

    if (pid !== null && isAlive(pid) && isHolder(path, { ...holder, pid })) return pid;

    // No pid yet: another Daemon may be between creating the file and writing it.
    if (pid === null && isFresh(path)) return -1;
    removeStale(path);
  }

  return readPid(path) ?? -1;
};

/**
 * Holds the Daemon lock for the lifetime of the scope.
 *
 * A lock naming this very process that this process does not hold was
 * inherited across an execve upgrade (same pid, new image) and is taken over.
 */
export const acquireLock = Effect.fnUntraced(function* (
  path: string
): Effect.fn.Return<void, DaemonAlreadyRunning | LockError, Scope.Scope> {
  yield* Effect.acquireRelease(
    Effect.try({
      try: () => claim(path),
      catch: (cause) => new LockError({ path, message: String(cause) }),
    }).pipe(
      Effect.flatMap((result) =>
        result === "acquired"
          ? Effect.sync(() => held.add(path))
          : Effect.fail(new DaemonAlreadyRunning({ pid: result === -1 ? null : result, path }))
      )
    ),
    () =>
      Effect.sync(() => {
        held.delete(path);

        if (readPid(path) === process.pid) {
          try {
            unlinkSync(path);
          } catch {}
        }
      })
  );
});

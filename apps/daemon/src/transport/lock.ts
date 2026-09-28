/**
 * Single-instance guard for the Daemon: one per user per Host.
 *
 * The lock file holds the owner's pid and is created with O_EXCL, so two
 * Daemons can't both create it. A lock whose pid is no longer alive is stale
 * and is taken over. The socket probe in `socket.ts` is the second line of
 * defence: a Daemon that answers on the socket always wins, whatever the lock
 * file says (covers pid reuse and a lock deleted by hand).
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

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const readPid = (path: string): number | null => {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);

    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

const isFresh = (path: string): boolean => {
  try {
    return Date.now() - statSync(path).mtimeMs < 2000;
  } catch {
    return false;
  }
};

const tryCreate = (path: string): boolean => {
  try {
    const fd = openSync(path, "wx", 0o600);

    try {
      writeSync(fd, `${process.pid}\n`);
    } finally {
      closeSync(fd);
    }

    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
};

/** Lock files this process holds right now. */
const held = new Set<string>();

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
      try: () => {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

        for (let attempt = 0; attempt < 3; attempt++) {
          if (tryCreate(path)) return "acquired" as const;
          const pid = readPid(path);

          if (pid === process.pid) return held.has(path) ? pid : ("acquired" as const);

          if (pid !== null && isAlive(pid)) return pid;

          // No pid yet: another Daemon may be between creating the file and writing it.
          if (pid === null && isFresh(path)) return -1;

          try {
            unlinkSync(path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }

        return readPid(path) ?? -1;
      },
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

/**
 * Single-instance guard for the Daemon: one per user per Host.
 *
 * The lock file holds the owner's pid and is created with O_EXCL, so two
 * Daemons can't both create it. A lock whose pid is no longer alive is stale
 * and is taken over. The socket probe in `socket.ts` is the second line of
 * defence: a Daemon that answers on the socket always wins, whatever the lock
 * file says (covers pid reuse and a lock deleted by hand).
 */
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs"
import { dirname } from "node:path"
import { Effect, Schema, type Scope } from "effect"

export class DaemonAlreadyRunning extends Schema.TaggedError<DaemonAlreadyRunning>()(
  "DaemonAlreadyRunning",
  {
    pid: Schema.NullOr(Schema.Int),
    path: Schema.String,
  },
) {
  override get message() {
    return this.pid === null
      ? `a Daemon is already listening on ${this.path}`
      : `a Daemon is already running (pid ${this.pid}, lock ${this.path})`
  }
}

export class LockError extends Schema.TaggedError<LockError>()("LockError", {
  path: Schema.String,
  message: Schema.String,
}) {}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

const readPid = (path: string): number | null => {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

const tryCreate = (path: string): boolean => {
  try {
    const fd = openSync(path, "wx", 0o600)
    try {
      writeSync(fd, `${process.pid}\n`)
    } finally {
      closeSync(fd)
    }
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false
    throw error
  }
}

/** Holds the Daemon lock for the lifetime of the scope. */
export const acquireLock = Effect.fnUntraced(function* (
  path: string,
): Effect.fn.Return<void, DaemonAlreadyRunning | LockError, Scope.Scope> {
  yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
        for (let attempt = 0; attempt < 3; attempt++) {
          if (tryCreate(path)) return "acquired" as const
          const pid = readPid(path)
          // An unreadable or half-written lock is treated as stale only once it stays that way.
          if (pid !== null && isAlive(pid)) return pid
          try {
            unlinkSync(path)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
          }
        }
        return readPid(path) ?? -1
      },
      catch: (cause) => new LockError({ path, message: String(cause) }),
    }).pipe(
      Effect.flatMap((result) =>
        result === "acquired"
          ? Effect.void
          : Effect.fail(new DaemonAlreadyRunning({ pid: result === -1 ? null : result, path })),
      ),
    ),
    () =>
      Effect.sync(() => {
        if (readPid(path) === process.pid) {
          try {
            unlinkSync(path)
          } catch {}
        }
      }),
  )
})

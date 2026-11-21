/**
 * A lock across processes around cargo's build, so parallel test files can't race rustup's
 * first-time toolchain install (ENG-995). It holds its owner's pid; a dead owner's is taken over.
 */
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { Schema } from "effect";

const POLL_MS = 50;

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

const owner = (path: string): number | null => {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);

    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

const tryTake = (path: string): boolean => {
  try {
    const fd = openSync(path, "wx");

    try {
      writeSync(fd, String(process.pid));
    } finally {
      closeSync(fd);
    }

    return true;
  } catch (error) {
    if (!isErrno(error) || error.code !== "EEXIST") throw error;

    return false;
  }
};

const release = (path: string): void => {
  try {
    if (owner(path) === process.pid) unlinkSync(path);
  } catch {}
};

/** Runs `work` while this process holds the lock at `path`, waiting for any other holder. */
export const withBuildLock = <A>(path: string, work: () => A): A => {
  mkdirSync(dirname(path), { recursive: true });

  while (!tryTake(path)) {
    const pid = owner(path);

    // A lock just created has no pid written yet; only a dead owner's lock is stale.
    if (pid !== null && !isAlive(pid)) {
      try {
        unlinkSync(path);
      } catch {}

      continue;
    }

    Bun.sleepSync(POLL_MS);
  }

  try {
    return work();
  } finally {
    release(path);
  }
};

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { acquireLock, DaemonAlreadyRunning } from "./lock.ts";
import { processStart } from "./processStart.ts";

let dir: string;

let lockPath: string;

let other: ChildProcess;

/** A live process that is not a Daemon, standing in for whatever was given a lock's pid. */
const spawnIdle = () =>
  new Promise<ChildProcess>((resolve) => {
    const child = spawn(process.execPath, ["-e", "console.log('up'); setTimeout(() => {}, 60000)"]);
    child.stdout?.once("data", () => resolve(child));
  });

/** Takes the lock and reports what happened, leaving the lock file as the attempt left it. */
const attempt = () =>
  Effect.runPromise(
    Effect.scoped(
      acquireLock(lockPath).pipe(
        Effect.as("acquired" as const),
        Effect.catchTag("DaemonAlreadyRunning", Effect.succeed)
      )
    )
  );

const pidOf = (child: ChildProcess) => {
  if (child.pid === undefined) throw new Error("the child has no pid");

  return child.pid;
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "polaris-lock-"));
  lockPath = join(dir, "daemon.lock");
  other = await spawnIdle();
});

afterEach(() => {
  other.kill("SIGKILL");
  rmSync(dir, { recursive: true, force: true });
});

const readsStarts = processStart(process.pid) !== null;

describe("a lock naming a live process", () => {
  test("is refused when that process wrote it", async () => {
    const pid = pidOf(other);
    writeFileSync(lockPath, `${pid}\n${processStart(pid)?.identity ?? ""}\n`);

    expect(await attempt()).toEqual(new DaemonAlreadyRunning({ pid, path: lockPath }));
    expect(readFileSync(lockPath, "utf8").split("\n")[0]).toBe(String(pid));
  });

  test("from an older Daemon is refused when that process started before it was written", async () => {
    const pid = pidOf(other);
    writeFileSync(lockPath, `${pid}\n`);

    expect(await attempt()).toEqual(new DaemonAlreadyRunning({ pid, path: lockPath }));
  });

  test.skipIf(!readsStarts)(
    "is taken over when its pid now belongs to another process",
    async () => {
      // Written by pid 1's process, which started at boot; `other` merely has the pid it names now.
      writeFileSync(lockPath, `${pidOf(other)}\n${processStart(1)?.identity}\n`);

      expect(await attempt()).toBe("acquired");
    }
  );

  test.skipIf(!readsStarts)(
    "from an older Daemon is taken over when its pid's process started later",
    async () => {
      writeFileSync(lockPath, `${pidOf(other)}\n`);
      const anHourAgo = new Date(Date.now() - 3_600_000);
      utimesSync(lockPath, anHourAgo, anHourAgo);

      expect(await attempt()).toBe("acquired");
    }
  );
});

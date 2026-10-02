import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function fixtureEnvironment(root) {
  const fixtureTemporaryPath = join(root, "tmp");

  mkdirSync(fixtureTemporaryPath, { recursive: true });

  return {
    PATH: process.env.PATH,
    TMPDIR: fixtureTemporaryPath,
    TMP: fixtureTemporaryPath,
    TEMP: fixtureTemporaryPath,
  };
}

export function groupExists(pid) {
  try {
    process.kill(-pid, 0);

    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;

    if (error.code === "EPERM") return true;
    throw error;
  }
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH" && error.code !== "EPERM") throw error;
  }
}

async function waitForGroup(pid, milliseconds) {
  const deadline = Date.now() + milliseconds;

  while (groupExists(pid) && Date.now() < deadline) await delay(20);

  return !groupExists(pid);
}

export function startServer(root, args) {
  if (process.platform === "win32")
    throw new Error("Fixture process-group cleanup requires macOS or Linux");

  const child = spawn(process.execPath, args, {
    cwd: root,
    env: fixtureEnvironment(root),
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const closed = new Promise((resolve) => child.once("close", resolve));

  let cleanup;

  return {
    child,
    async stop(reason) {
      cleanup ??= (async () => {
        signalGroup(child.pid, "SIGTERM");

        if (!(await waitForGroup(child.pid, 1000))) signalGroup(child.pid, "SIGKILL");

        if (!(await waitForGroup(child.pid, 2000)))
          throw new Error(`Server group ${child.pid} survived termination`);
        await withDeadline(closed, 1000);
        console.log(`Cleanup ${reason}: server group ${child.pid} reaped; no remaining group`);
      })();
      await cleanup;
    },
  };
}

export async function withDeadline(operation, milliseconds) {
  let timer;

  try {
    return await Promise.race([
      operation,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Fixture deadline exceeded")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

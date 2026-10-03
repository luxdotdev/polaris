import { spawn } from "node:child_process";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bounds } from "./manifest.ts";

const output = process.argv[2];

if (!output) throw new Error("Pass a NEW owned temporary evidence directory");

await mkdir(output);

const temporary = await mkdtemp(join(tmpdir(), "m31-joint-functional-"));

const log = await open(join(output, "run.log"), "w");

const inherited = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "CI",
];

const env: Record<string, string> = {};

for (const key of inherited) {
  const value = process.env[key];

  if (value !== undefined) env[key] = value;
}

const home = join(temporary, "private-home");

await mkdir(home);

env.POLARIS_HOME = home;

env.GIT_CONFIG_GLOBAL = "/dev/null";

env.GIT_CONFIG_NOSYSTEM = "1";

const child = spawn(
  process.execPath,
  [join(import.meta.dirname, "worker.ts"), resolve(output), temporary],
  {
    detached: true,
    env,
    stdio: ["ignore", log.fd, log.fd],
  }
);

const completion = new Promise<number | null>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code));
});

const pid = child.pid;

if (pid === undefined) {
  await completion.catch(() => {});
  await log.close();
  await rm(temporary, { recursive: true, force: true });
  await writeFile(
    join(output, "cleanup.json"),
    JSON.stringify({ exitCode: null, spawnFailed: true, rootRemoved: true })
  );
  throw new Error("Joint worker did not start");
}

await writeFile(
  join(output, "owned.json"),
  JSON.stringify({ pid, processGroup: pid, temporary, home })
);

const signal = (name: NodeJS.Signals) => {
  try {
    process.kill(-pid, name);
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) throw cause;
  }
};

const alive = () => {
  try {
    process.kill(-pid, 0);

    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ESRCH") return false;
    throw cause;
  }
};

let timedOut = false;

let forced: ReturnType<typeof setTimeout> | undefined;

const deadline = setTimeout(() => {
  timedOut = true;
  signal("SIGTERM");
  forced = setTimeout(() => signal("SIGKILL"), bounds.terminateMs);
}, bounds.totalMs);

const terminate = () => signal("SIGTERM");

process.once("SIGINT", terminate);

process.once("SIGTERM", terminate);

let exitCode: number | null = null;

let rootRemoved = false;

try {
  exitCode = await completion;
} finally {
  clearTimeout(deadline);
  clearTimeout(forced);
  process.removeListener("SIGINT", terminate);
  process.removeListener("SIGTERM", terminate);

  if (alive()) signal("SIGKILL");

  for (let attempt = 0; attempt < 20 && alive(); attempt++)
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

  if (!alive()) {
    await rm(temporary, { recursive: true, force: true });
    rootRemoved = true;
  }

  await log.close();
  await writeFile(
    join(output, "cleanup.json"),
    JSON.stringify({ exitCode, timedOut, ownedProcessGroupAlive: alive(), rootRemoved }, null, 2)
  );
}

process.exitCode = exitCode === 0 && rootRemoved && !timedOut ? 0 : 1;

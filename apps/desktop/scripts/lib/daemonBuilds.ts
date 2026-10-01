import { spawn } from "node:child_process";
import { join } from "node:path";
import { REPO_ROOT } from "./electron.ts";

/** Refresh every target together: a new manifest version discards older target entries. */
export const prepareDaemonBuilds = (env = process.env): Promise<void> => {
  if (env.POLARIS_DESKTOP_DAEMON_DIST) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const child = spawn("bun", [join(REPO_ROOT, "scripts/build-daemon.ts")], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Daemon builds failed (exit ${code})`))
    );
  });
};

import { childEnv } from "../service/childEnv.ts";
import { execFile } from "node:child_process";
import { windowsProcessStart } from "../platform/windowsProcessTime.ts";

/** A PID plus its start time distinguishes a recovered child from a reused PID. */
export const processIdentity = (pid: number): Promise<string | null> => {
  // Windows has no `ps`: its kernel reports the start time (a FILETIME) directly.
  if (process.platform === "win32") {
    const started = windowsProcessStart(pid);

    return Promise.resolve(started === null ? null : `filetime ${started}`);
  }

  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-o", "stat=", "-o", "lstart=", "-p", String(pid)],
      { env: childEnv() },
      (error, stdout) => {
        const line = stdout.trim();

        if (error !== null || line.length === 0 || /^[ZX]/.test(line)) resolve(null);
        else resolve(line.replace(/^\S+\s+/, ""));
      }
    );
  });
};

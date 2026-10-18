import { childEnv } from "../service/childEnv.ts";
import { execFile } from "node:child_process";
import { findExecutable } from "../platform/executable.ts";
import { processCreated } from "../platform/windowsNative.ts";

/** A PID plus its start time distinguishes a recovered child from a reused PID. */
export const processIdentity = (pid: number): Promise<string | null> => {
  // Windows has no `ps`: its kernel reports the start time (a FILETIME) directly.
  if (process.platform === "win32") {
    const started = processCreated(pid);

    return Promise.resolve(started === null ? null : `filetime ${started}`);
  }

  const ps = findExecutable("ps");

  if (ps === null) return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile(
      ps,
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

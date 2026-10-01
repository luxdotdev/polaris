import { execFile } from "node:child_process";

/** A PID plus its start time distinguishes a recovered child from a reused PID. */
export const processIdentity = (pid: number): Promise<string | null> =>
  new Promise((resolve) => {
    execFile("ps", ["-o", "stat=", "-o", "lstart=", "-p", String(pid)], (error, stdout) => {
      const line = stdout.trim();

      if (error !== null || line.length === 0 || /^[ZX]/.test(line)) resolve(null);
      else resolve(line.replace(/^\S+\s+/, ""));
    });
  });

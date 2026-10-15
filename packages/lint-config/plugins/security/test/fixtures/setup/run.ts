// Planted: a repository-code launcher leaking the Daemon's environment. Each line is one report.
import { spawn } from "node:child_process";

declare const childEnv: (source?: object) => Record<string, string>;
declare const setupEnv: (source?: object) => Record<string, string>;

export const planted = (command: string) => {
  Bun.spawn(["/bin/sh", "-c", command], { env: { ...process.env } });
  Bun.spawn(["/bin/sh", "-c", command], { env: childEnv() });
  Bun.spawn(["/bin/sh", "-c", command], { stdout: "pipe" });
  spawn("/bin/sh", ["-c", command]);
};

// The allowlisted builder, one variable read, and a default: no report.
export const fine = (command: string, source: object = process.env) => {
  const home = process.env.HOME;

  return [Bun.spawn(["/bin/sh", "-c", command], { env: setupEnv(process.env) }), home, source];
};

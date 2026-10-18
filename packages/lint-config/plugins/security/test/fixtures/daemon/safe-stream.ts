// Allowlisted safe-path user that keeps the safe config and git's absolute path: no report.
declare const safeConfigEnv: (cwd: string) => Promise<Record<string, string>>;
declare const gitExecutable: () => string;

export const grep = async (cwd: string) =>
  Bun.spawn([gitExecutable(), "grep", "-e", "x"], { cwd, env: await safeConfigEnv(cwd) });

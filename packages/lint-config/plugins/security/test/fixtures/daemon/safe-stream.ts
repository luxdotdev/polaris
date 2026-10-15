// Allowlisted safe-path user that keeps the safe config: no report.
declare const safeConfigEnv: (cwd: string) => Promise<Record<string, string>>;

export const grep = async (cwd: string) =>
  Bun.spawn(["git", "grep", "-e", "x"], { cwd, env: await safeConfigEnv(cwd) });

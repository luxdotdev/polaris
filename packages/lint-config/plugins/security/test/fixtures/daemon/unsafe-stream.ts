// Allowlisted as a safe-path user, but it dropped the safe config: one report for the file.
export const grep = (cwd: string) =>
  Bun.spawn(["git", "grep", "-e", "x"], { cwd, env: { PATH: "/usr/bin" } });

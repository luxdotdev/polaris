// Allowlisted as a safe-path user, but it dropped the safe config: one report for the file.
declare const gitExecutable: () => string;

export const grep = (cwd: string) =>
  Bun.spawn([gitExecutable(), "grep", "-e", "x"], { cwd, env: { PATH: "/usr/bin" } });

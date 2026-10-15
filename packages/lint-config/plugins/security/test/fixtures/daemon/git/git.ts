// The allowlisted gate: its spawns are sanctioned, so no report.
export const runGitRaw = (cwd: string, args: ReadonlyArray<string>) =>
  Bun.spawn(["git", ...args], { cwd, env: { ...process.env } });

export const viaHost = (cwd: string) =>
  runGitRaw(cwd, ["commit"]).exited.then(() => ({ config: "host" }));

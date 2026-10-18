// The allowlisted gate: its spawns are sanctioned, so no report, but for a bare `git`.
declare const gitExecutable: () => string;

export const runGitRaw = (cwd: string, args: ReadonlyArray<string>) =>
  Bun.spawn([gitExecutable(), ...args], { cwd, env: { ...process.env } });

export const viaHost = (cwd: string) =>
  runGitRaw(cwd, ["commit"]).exited.then(() => ({ config: "host" }));

// Planted: a bare `git`, which Windows looks up in the cwd first. One report each.
export const bare = (cwd: string) => {
  Bun.spawn(["git", "status"], { cwd, env: { ...process.env } });
  Bun.spawnSync({ cmd: ["git", "log"], cwd, env: { ...process.env } });
};

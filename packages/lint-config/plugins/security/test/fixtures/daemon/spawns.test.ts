// A test sets up its own repositories: exempt, no report.
export const setup = (cwd: string) => Bun.spawnSync(["git", "init"], { cwd });

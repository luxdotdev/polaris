// Planted: every way the Daemon could start git outside git.ts. Each line is one report.
import { execFile, execSync, spawn, spawnSync } from "node:child_process";
import { $ } from "bun";

const GIT = "git";
const found = Bun.which("git");
declare const gitExecutable: () => string;

export const planted = async (cwd: string) => {
  Bun.spawn(["git", "status"], { cwd });
  Bun.spawnSync({ cmd: ["git", "log"], cwd });
  spawn("git", ["fetch"], { cwd });
  spawnSync("/usr/bin/git", ["status"]);
  execFile(GIT, ["show"]);
  execSync("git config --list");
  Bun.spawn([found ?? "git", "diff"], { cwd });
  await $`git status`;
  Bun.spawn([gitExecutable(), "status"], { cwd });
};

// Not git, or not a spawn: no report.
export const fine = (cwd: string) => {
  Bun.spawn(["ps", "-o", "command="], { cwd });
  /^git (\S+)$/.exec("git status");
  const args = ["git", ".", "--log-opts=x"];

  return args;
};

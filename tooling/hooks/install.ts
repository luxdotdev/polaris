#!/usr/bin/env bun
/**
 * `bun install` runs this (the root `prepare` script): points git at the committed
 * hooks in tooling/hooks. The path is relative, so each checkout and worktree runs
 * its own copy with its own node_modules. Outside a git checkout it does nothing.
 */
const inside = Bun.spawnSync(["git", "rev-parse", "--is-inside-work-tree"], {
  cwd: import.meta.dir,
});

if (inside.exitCode === 0 && process.env.CI === undefined) {
  Bun.spawnSync(["git", "config", "core.hooksPath", "tooling/hooks"], { cwd: import.meta.dir });
}

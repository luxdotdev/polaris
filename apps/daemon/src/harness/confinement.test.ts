import { afterEach, expect, test } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { isWithin } from "../files/fs.ts";
import { gitText } from "../git/git.ts";
import { makeRepo, removeDir, tempDir } from "../git/testing.ts";
import { readConfinement } from "./confinement.ts";

const cleanup: Array<string> = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) removeDir(dir);
});

const TOKEN = "ghp_reviewerMustNeverSeeThis";

const reviewCheckout = async () => {
  const repo = await makeRepo();
  const base = tempDir("polaris-confine-");
  cleanup.push(repo, base);
  await gitText(repo, ["remote", "add", "origin", `https://x:${TOKEN}@github.com/o/r.git`]);
  const checkout = join(base, "pr-7");
  await gitText(repo, ["worktree", "add", "-q", "--detach", checkout]);
  const common = realpathSync(join(repo, ".git"));
  const gitDir = realpathSync(await gitText(checkout, ["rev-parse", "--absolute-git-dir"]));

  return { repo, base, checkout, common, gitDir };
};

const covered = (roots: ReadonlyArray<string>, path: string) =>
  roots.some((root) => isWithin(root, path));

test("a Review Checkout's shell reads a fixed toolchain, never the PATH's other directories, home or above it", async () => {
  const { base, checkout, common } = await reviewCheckout();
  const tools = join(base, "tools/bin");
  mkdirSync(tools, { recursive: true });
  const home = realpathSync(homedir());

  const confinement = await readConfinement(checkout, { PATH: [tools, home].join(delimiter) });
  const outsideGit = confinement.shellRoots.filter((root) => !isWithin(common, root));

  expect(confinement.root).toBe(checkout);
  expect(outsideGit).not.toContain(tools);

  for (const root of outsideGit) {
    expect(isWithin(root, home)).toBe(false);
    expect(isWithin(home, root)).toBe(false);
  }

  expect(covered([checkout, ...confinement.shellRoots], dirname(checkout))).toBe(false);
});

test("the shell's git reads history through a sanitized config, never one that can hold a credential", async () => {
  const { checkout, common, gitDir } = await reviewCheckout();
  // A worktree's own config is read only with this extension, and can name a remote too.
  await gitText(common, ["config", "extensions.worktreeConfig", "true"]);
  writeFileSync(
    join(gitDir, "config.worktree"),
    `[remote "fork"]\n\turl = https://x:${TOKEN}@github.com/f/r.git\n[credential]\n\thelper = store\n[include]\n\tpath = /tmp/elsewhere\n`
  );

  const confinement = await readConfinement(checkout, { PATH: "" });
  const env = { ...confinement.shellEnv };
  const readable = [confinement.root, ...confinement.shellRoots];

  for (const secret of [
    join(common, "config"),
    join(gitDir, "config.worktree"),
    join(common, "worktrees", "other"),
  ])
    expect(covered(readable, secret)).toBe(false);

  expect(await gitText(checkout, ["log", "--format=%s"], { env })).toBe("initial");
  const config = await gitText(checkout, ["config", "--list"], { env });
  expect(config).toContain("core.repositoryformatversion");

  for (const leak of [TOKEN, "credential.", "include.", "remote."])
    expect(config).not.toContain(leak);
});

test("a checkout that is the repository itself has its git dir hidden, and no git", async () => {
  const repo = await makeRepo();
  cleanup.push(repo);

  const confinement = await readConfinement(repo, { PATH: "" });

  expect(confinement.hidden).toContain(join(repo, ".git"));
  expect(confinement.shellEnv).not.toHaveProperty("GIT_COMMON_DIR");
});

test("a Harness's config dir inside the checkout is hidden", async () => {
  const { checkout } = await reviewCheckout();
  const claude = join(checkout, ".claude-config");
  mkdirSync(claude);

  const confinement = await readConfinement(checkout, { PATH: "", CLAUDE_CONFIG_DIR: claude });

  expect(confinement.hidden).toEqual([claude]);
});

test("a checkout that holds the home directory can't be confined", async () => {
  const failure = await readConfinement(dirname(homedir()), { PATH: "" }).then(() => null, String);

  expect(failure).toContain("holds your home directory");
});

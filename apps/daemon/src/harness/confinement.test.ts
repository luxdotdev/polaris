import { afterEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
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

  return { repo, base, checkout, common: realpathSync(join(repo, ".git")) };
};

test("a Review Checkout's shell may read the PATH's tools, never home, a parent of it or `/`", async () => {
  const { base, checkout, common } = await reviewCheckout();
  const tools = join(base, "tools/bin");
  mkdirSync(tools, { recursive: true });
  const home = realpathSync(homedir());

  const confinement = await readConfinement(checkout, {
    PATH: [
      tools,
      home,
      dirname(home),
      dirname(common),
      "/",
      "relative/bin",
      join(base, "missing"),
      tools,
    ].join(delimiter),
  });

  expect(confinement.root).toBe(checkout);
  expect(confinement.shellRoots.filter((root) => !isWithin(common, root))).toEqual([tools]);
  expect(confinement.denied).toContain(home);
  expect(confinement.denied).toContain(common);
});

test("the shell's git reads history through a sanitized config, never the repository's own", async () => {
  const { checkout, common } = await reviewCheckout();

  const confinement = await readConfinement(checkout, { PATH: "" });
  const env = { ...confinement.gitEnv };

  // Neither the config nor another worktree's git dir is readable by the shell.
  for (const secret of [join(common, "config"), join(common, "worktrees", "other")])
    expect(confinement.shellRoots.filter((root) => isWithin(root, secret))).toEqual([]);

  expect(await gitText(checkout, ["log", "--format=%s"], { env })).toBe("initial");
  expect(await gitText(checkout, ["config", "--list"], { env })).not.toContain(TOKEN);
  const sanitized = join(env.GIT_COMMON_DIR ?? "", "config");
  expect(readFileSync(sanitized, "utf8")).toContain("repositoryformatversion");
});

test("in the repository itself the git dir is already inside the root", async () => {
  const repo = await makeRepo();
  cleanup.push(repo);

  const confinement = await readConfinement(repo, { PATH: "" });

  expect(confinement.shellRoots).toEqual([]);
  expect(confinement.gitEnv).toEqual({ GIT_CONFIG_GLOBAL: "/dev/null" });
});

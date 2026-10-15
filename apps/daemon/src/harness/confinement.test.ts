import { afterEach, expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { gitText } from "../git/git.ts";
import { makeRepo, removeDir, tempDir } from "../git/testing.ts";
import { readConfinement } from "./confinement.ts";

const cleanup: Array<string> = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) removeDir(dir);
});

test("a Review Checkout's shell may read its repository's git dir and the PATH's tools, not home", async () => {
  const repo = await makeRepo();
  const base = tempDir("polaris-confine-");
  cleanup.push(repo, base);
  const checkout = join(base, "pr-7");
  await gitText(repo, ["worktree", "add", "-q", "--detach", checkout]);
  const tools = join(base, "tools/bin");
  mkdirSync(tools, { recursive: true });
  const home = realpathSync(homedir());

  const confinement = await readConfinement(checkout, {
    PATH: [tools, home, "/", "relative/bin", join(base, "missing"), tools].join(delimiter),
  });

  expect(confinement.root).toBe(checkout);
  expect(confinement.shellRoots).toEqual([realpathSync(join(repo, ".git")), tools]);
  expect(confinement.denied).toContain(home);
});

test("in the repository itself the git dir is already inside the root", async () => {
  const repo = await makeRepo();
  cleanup.push(repo);

  expect((await readConfinement(repo, { PATH: "" })).shellRoots).toEqual([]);
});

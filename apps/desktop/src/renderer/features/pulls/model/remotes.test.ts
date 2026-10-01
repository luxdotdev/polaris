import { describe, expect, test } from "bun:test";
import { gitdirOf, readRemotes, remotesInConfig, resolvePath } from "./remotes.ts";

const CONFIG = `[core]
	repositoryformatversion = 0
	bare = false
[remote "origin"]
	url = git@github.com:acme/widgets.git
	fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
	remote = origin
[remote "upstream"]
	URL = "https://github.com/upstream/widgets"
	pushurl = git@github.com:acme/widgets.git
[url "git@github.com:"]
	insteadOf = https://github.com/
`;

describe("remotesInConfig", () => {
  test("every remote's url once, in file order", () => {
    expect(remotesInConfig(CONFIG)).toEqual([
      "git@github.com:acme/widgets.git",
      "https://github.com/upstream/widgets",
    ]);
  });

  test("nothing outside remote sections", () => {
    expect(remotesInConfig('[branch "main"]\n\turl = nope\n[core]\nurl = x')).toEqual([]);
  });
});

describe("worktrees", () => {
  test("gitdir and relative paths", () => {
    expect(gitdirOf("gitdir: /repo/.git/worktrees/feature\n")).toBe("/repo/.git/worktrees/feature");
    expect(gitdirOf("not a gitdir")).toBeNull();
    expect(resolvePath("/repo/.git/worktrees/feature", "../..")).toBe("/repo/.git");
    expect(resolvePath("/a/b", "/abs/c/")).toBe("/abs/c");
  });

  test("a linked Worktree reads the common config", async () => {
    const files = new Map<string, string>(
      Object.entries({
        "/wt/feature/.git": "gitdir: /repo/.git/worktrees/feature",
        "/repo/.git/worktrees/feature/commondir": "../..\n",
        "/repo/.git/config": CONFIG,
      })
    );

    const read = async (path: string) => files.get(path) ?? null;

    expect(await readRemotes("/wt/feature/", read)).toHaveLength(2);
    expect(
      await readRemotes("/repo", async (p) => (p === "/repo/.git/config" ? CONFIG : null))
    ).toHaveLength(2);
    expect(await readRemotes("/nowhere", read)).toEqual([]);
  });
});

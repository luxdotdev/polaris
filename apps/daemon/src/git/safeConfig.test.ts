import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { makeFakeBlobChannel } from "../files/testing.ts";
import { DiffSpec } from "./diff.ts";
import { handleGitDiff, handleGitStatus } from "./GitRpcs.ts";
import { GitOutputTooLarge, gitText, runGitRaw } from "./git.ts";
import { pinCommits } from "./review/fetch.ts";
import { reviewRef } from "./review/refs.ts";
import { repositoryDrivers } from "./safeConfig.ts";
import { showFile } from "./show.ts";
import { commitAll, makeRepo, removeDir, tempDir, write } from "./testing.ts";

const cleanup: Array<string> = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) removeDir(dir);
});

const dir = (made: string) => {
  cleanup.push(made);

  return made;
};

/** A script that leaves `<name>.ran` in `markers` and passes its stdin through. */
const script = (markers: string, name: string) => {
  const path = join(markers, name);
  write(markers, name, `#!/bin/sh\ntouch "${markers}/${name}.ran"\ncat\n`);
  chmodSync(path, 0o755);

  return path;
};

const ran = (markers: string) =>
  readdirSync(markers)
    .filter((f) => f.endsWith(".ran"))
    .map((f) => f.replace(/\.ran$/, ""))
    .sort();

/** A Workspace that arrived with its own `.git/config`: every setting here names a command. */
const prepared = async () => {
  const markers = dir(tempDir("polaris-markers-"));

  const root = dir(
    await makeRepo({ "a.txt": "a\n", ".gitattributes": "*.txt filter=evil diff=evil\n" })
  );

  const set = (key: string, value: string) => gitText(root, ["config", key, value]);

  await set("core.fsmonitor", script(markers, "fsmonitor"));
  await set("filter.evil.clean", script(markers, "clean"));
  await set("diff.evil.textconv", script(markers, "textconv"));
  await set("diff.external", script(markers, "external"));
  write(root, "a.txt", "b\n");

  return { root, markers };
};

describe("automatic git in a Workspace's repository", () => {
  test("the explorer's status runs none of the commands the repository's config names", async () => {
    const { root, markers } = await prepared();

    const status = await Effect.runPromise(handleGitStatus({ cwd: root }));

    expect(status.entries.map((e) => `${e.worktree} ${e.path}`)).toEqual(["M a.txt"]);
    expect(ran(markers)).toEqual([]);

    // The control: with the Host's config as it is, git runs them.
    await runGitRaw(root, ["status", "--porcelain"], { config: "host" });
    expect(ran(markers)).toEqual(["clean", "fsmonitor"]);
  });

  test("a working-tree diff snapshots and diffs without a filter, textconv or external diff", async () => {
    const { root, markers } = await prepared();
    const blobs = makeFakeBlobChannel();

    const result = await Effect.runPromise(
      handleGitDiff({ cwd: root, spec: DiffSpec.cases.WorkingTree.make({ base: null }) }).pipe(
        Effect.provide(blobs.layer)
      )
    );

    expect(new TextDecoder().decode(blobs.blobs.get(result.blobId))).toContain("-a\n+b\n");
    expect(ran(markers)).toEqual([]);

    await runGitRaw(root, ["diff"], { config: "host" });
    expect(ran(markers)).toEqual(["clean", "external", "fsmonitor"]);
  });

  test("a filter the repository's config gains later is turned off too", async () => {
    const markers = dir(tempDir("polaris-markers-"));
    const root = dir(await makeRepo({ "a.txt": "a\n", ".gitattributes": "*.txt filter=late\n" }));
    await gitText(root, ["status", "--porcelain"]);

    await gitText(root, ["config", "filter.late.clean", script(markers, "late")]);
    write(root, "a.txt", "b\n");
    await gitText(root, ["status", "--porcelain"]);

    expect(ran(markers)).toEqual([]);
  });

  test("pinning a session's Turns for Review runs no hook, even through a relative hooksPath", async () => {
    const root = dir(await makeRepo({ "a.txt": "a\n" }));
    const base = await gitText(root, ["rev-parse", "HEAD"]);
    write(root, "a.txt", "b\n");
    const head = await commitAll(root, "turn");
    write(root, ".hooks/reference-transaction", `#!/bin/sh\ntouch "${root}/hook.ran"\n`);
    chmodSync(join(root, ".hooks/reference-transaction"), 0o755);
    await gitText(root, ["config", "core.hooksPath", ".hooks"]);

    await pinCommits({ repoPath: root, key: "session-s1", head, base });

    expect(await gitText(root, ["rev-parse", reviewRef("session-s1", "head")])).toBe(head);
    expect(existsSync(join(root, "hook.ran"))).toBe(false);
  });
});

describe("repositoryDrivers", () => {
  test("turns off the local and worktree drivers, keeps the user's own and git-lfs's", () => {
    const listing = [
      "global",
      "filter.lfs.clean\ngit-lfs clean -- %f",
      "global",
      "filter.mine.clean\nmy-clean",
      "local",
      "filter.lfs.process\ngit-lfs filter-process",
      "local",
      "filter.evil.smudge\nrm -rf ~",
      "worktree",
      "merge.evil.driver\nsh evil.sh",
      "local",
      "core.bare\nfalse",
      "",
    ].join("\0");

    expect(repositoryDrivers(listing)).toEqual({
      overrides: [
        ["filter.evil.smudge", ""],
        ["merge.evil.driver", ""],
      ],
      cacheable: true,
    });
  });

  test("a repository whose config includes another file is read every time", () => {
    expect(repositoryDrivers("local\0include.path\n../x.cfg\0").cacheable).toBe(false);
    expect(repositoryDrivers("local\0includeif.onbranch:main.path\nx\0").cacheable).toBe(false);
  });
});

describe("output limits", () => {
  test("git that prints past its limit is stopped, and the call fails as too large", async () => {
    const root = dir(await makeRepo({ "big.txt": "x".repeat(1024 * 1024) }));

    const failure = await runGitRaw(root, ["cat-file", "blob", "HEAD:big.txt"], {
      maxOutputBytes: 64 * 1024,
    }).catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(GitOutputTooLarge);
  });

  test("git.show refuses a file past its limit in the words the Desktop App shows", async () => {
    const root = dir(await makeRepo({ "a.txt": "a\n" }));
    write(root, "huge.bin", "\0".repeat(65 * 1024 * 1024));
    await commitAll(root, "huge");

    const failure = await showFile(root, "HEAD", "huge.bin").catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(GitOutputTooLarge);
    expect(failure).toMatchObject({ message: "This file is larger than 64 MB, too large to show" });
  });
});

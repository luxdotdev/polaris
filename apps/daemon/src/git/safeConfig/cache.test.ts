/**
 * The cached config listing on real repositories: kept while nothing git reads for it
 * changed (a branch switch, an inert `-c`), read again when something did.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitText } from "../git.ts";
import { makeRepo, removeDir, tempDir, write } from "../testing.ts";

const cleanup: Array<string> = [];

const PATH = process.env.PATH;

afterEach(() => {
  process.env.PATH = PATH;

  for (const dir of cleanup.splice(0)) removeDir(dir);
});

const dir = (made: string) => {
  cleanup.push(made);

  return made;
};

/** Puts a `git` first on PATH that logs each call's arguments; answers how many listed config. */
const countListings = () => {
  const bin = dir(tempDir("polaris-git-log-"));
  const log = join(bin, "calls");
  const real = Bun.which("git") ?? "git";
  writeFileSync(log, "");
  write(bin, "git", `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexec "${real}" "$@"\n`);
  chmodSync(join(bin, "git"), 0o755);
  process.env.PATH = `${bin}:${PATH ?? ""}`;

  return () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line.includes("config --list")).length;
};

describe("the cached config listing", () => {
  test("survives a branch switch and a commit on a detached HEAD", async () => {
    const root = dir(await makeRepo({ "a.txt": "a\n" }));
    await gitText(root, ["status", "--porcelain"]);
    const listings = countListings();

    await gitText(root, ["branch", "other"]);
    await gitText(root, ["symbolic-ref", "HEAD", "refs/heads/other"]);
    await gitText(root, ["status", "--porcelain"]);
    const head = await gitText(root, ["rev-parse", "HEAD"]);
    await gitText(root, ["update-ref", "--no-deref", "HEAD", head]);
    await gitText(root, ["status", "--porcelain"]);

    expect(listings()).toBe(0);
  });

  test("is shared by a call with the Daemon's inert `-c` settings", async () => {
    const root = dir(await makeRepo({ "a.txt": "a\n" }));
    await gitText(root, ["status", "--porcelain"]);
    const listings = countListings();

    await gitText(root, ["-c", "core.splitIndex=false", "-c", "index.skipHash=true", "status"]);
    await gitText(root, ["-c", "core.hooksPath=/dev/null", "status", "--porcelain"]);

    expect(listings()).toBe(0);
  });

  test("is read again when the branch decides a Host include", async () => {
    const root = dir(await makeRepo({ "a.txt": "a\n" }));
    await gitText(root, ["config", "core.sshCommand", "evil-ssh"]);
    const home = dir(tempDir("polaris-home-"));
    write(home, "feature", "[core]\n\tsshCommand = feature-ssh\n");
    write(home, "gitconfig", `[includeIf "onbranch:feature"]\n\tpath = ${join(home, "feature")}\n`);
    const env = { GIT_CONFIG_GLOBAL: join(home, "gitconfig") };
    const ssh = () => gitText(root, ["config", "--get", "core.sshCommand"], { env });
    expect(await ssh()).toBe("ssh");

    await gitText(root, ["branch", "feature"]);
    await gitText(root, ["symbolic-ref", "HEAD", "refs/heads/feature"]);

    expect(await ssh()).toBe("feature-ssh");
  });

  test("is read again when a folder's HEAD becomes valid and git takes it as a repository", async () => {
    const markers = dir(tempDir("polaris-markers-"));
    const root = dir(await makeRepo({ "a.txt": "a\n" }));
    const pkg = join(root, "pkg");

    // A `.git` git passes over: everything a repository has but a HEAD it takes.
    for (const sub of ["objects", "refs/heads"])
      mkdirSync(join(pkg, ".git", sub), { recursive: true });
    write(pkg, ".git/HEAD", "not a head\n");
    write(pkg, "b.txt", "b\n");
    await gitText(pkg, ["status", "--porcelain"]);

    const clean = join(markers, "clean");
    write(markers, "clean", `#!/bin/sh\ntouch "${clean}.ran"\ncat\n`);
    chmodSync(clean, 0o755);
    write(pkg, ".git/config", `[filter "inner"]\n\tclean = ${clean}\n`);
    write(pkg, ".gitattributes", "*.txt filter=inner\n");
    write(pkg, ".git/HEAD", "ref: refs/heads/main\n");
    await gitText(pkg, ["add", "-A"]);

    expect(await gitText(pkg, ["rev-parse", "--show-toplevel"])).toBe(pkg);
    expect(existsSync(`${clean}.ran`)).toBe(false);
  });
});

/**
 * A git that hangs under a per-command snapshot (ADR 0117): a `git` first on PATH that sleeps
 * in `add` on the command index while a flag file exists, and is the real git otherwise.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCheckpoint } from "./Checkpoints.ts";
import { CommandSnapshots } from "./commandSnapshots.ts";
import { resetSnapshotCaches } from "./snapshot.ts";
import { HEAVY_GIT_MS, makeRepo } from "./testing.ts";

const unix = process.platform !== "win32";

const path = process.env["PATH"];

let dir = "";

/** Makes every `add` on the command index hang from now on; `free` lets git through again. */
const hangGit = () => {
  const real = Bun.which("git");
  const flag = join(dir, "hang");
  const started = join(dir, "started");

  const script = `#!/bin/sh
case "$GIT_INDEX_FILE:$*" in
  *command-index:*" add "*)
    if [ -e '${flag}' ]; then
      sleep 600 &
      echo "$$ $!" >> '${started}'
      wait
    fi
    ;;
esac
exec '${real}' "$@"
`;

  writeFileSync(join(dir, "git"), script);
  chmodSync(join(dir, "git"), 0o755);
  writeFileSync(flag, "");
  process.env["PATH"] = `${dir}:${path}`;

  /** The hung gits so far, each with the `sleep` it started. */
  const pids = () =>
    existsSync(started)
      ? readFileSync(started, "utf8").trim().split(/\s+/).map(Number)
      : new Array<number>();

  return { pids, free: () => rmSync(flag) };
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

const until = async (met: () => boolean) => {
  while (!met()) await Bun.sleep(10);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "polaris-hung-git-"));
});

afterEach(() => {
  process.env["PATH"] = path;
  resetSnapshotCaches();
  rmSync(dir, { recursive: true, force: true });
});

const scope = (cwd: string) => ({ cwd, sessionId: "s1", turnId: "t1" });

test.skipIf(!unix)(
  "a hung snapshot holds neither the Turn's checkpoint nor the next command, and its git ends with the Turn",
  async () => {
    const repo = await makeRepo({ "README.md": "hello\n" });
    const git = hangGit();
    // Neither the budget nor the hard limit ends this one: only the Turn does.
    const snapshots = new CommandSnapshots({ budgetMs: 60_000, hardMs: 60_000 });
    const turn = new AbortController();
    const held = snapshots.started("c1", scope(repo), turn.signal);
    await until(() => git.pids().length === 2);

    // A second command's snapshot waits behind it, and is dropped there when its hook is cancelled.
    const hook = new AbortController();
    const queued = snapshots.started("c2", scope(repo), hook.signal);
    hook.abort();
    await queued;

    // The Turn's checkpoint has an index of its own: it is taken while that git hangs.
    const checkpoint = await captureCheckpoint({ ...scope(repo), label: "before" });

    expect(checkpoint?.commit).toMatch(/^[0-9a-f]{40,64}$/);
    expect(git.pids().every(alive)).toBe(true);

    turn.abort();
    await held;
    await until(() => !git.pids().some(alive));

    // Only the first command's git ever started.
    expect(git.pids().length).toBe(2);

    git.free();
    await snapshots.started("c3", scope(repo));
    writeFileSync(join(repo, "next.txt"), "next\n");

    expect((await snapshots.ended("c3"))?.changes).toEqual([
      {
        path: join(repo, "next.txt"),
        kind: "add",
        patch: { diff: "@@ -0,0 +1 @@\n+next\n", added: 1, removed: 0, truncated: false },
      },
    ]);
  },
  HEAVY_GIT_MS
);

test.skipIf(!unix)(
  "a snapshot past the hard limit is killed, and the tree is left alone for a while",
  async () => {
    const repo = await makeRepo({ "README.md": "hello\n" });
    const git = hangGit();
    const snapshots = new CommandSnapshots({ budgetMs: 100, hardMs: 400 });

    // The command is let go after its budget; the snapshot after it hangs to the hard limit.
    await snapshots.started("c1", scope(repo));
    await until(() => !git.pids().some(alive));

    expect(await snapshots.ended("c1")).toBeNull();
    expect(git.pids().length).toBe(4);
    expect(git.pids().some(alive)).toBe(false);
    expect(snapshots.modeOf(repo)).toBe("off");
  },
  HEAVY_GIT_MS
);

/**
 * The Daemon reads a Write's old file only when it is a regular text file inside the session's
 * directory, including when the path is swapped between the check and the read.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPreviousFile } from "./readPrevious.ts";

let dir = "";

let repo = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "polaris-previous-"));
  repo = join(dir, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(dir, "outside", "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.txt"), "inside\n");
  writeFileSync(join(dir, "outside", "src", "a.txt"), "token\n");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const mkfifo = (path: string) => {
  expect(Bun.spawnSync(["mkfifo", path]).exitCode).toBe(0);
};

describe("readPreviousFile", () => {
  test("reads a text file, says a missing one is absent, and leaves binary unknown", async () => {
    writeFileSync(join(repo, "b.bin"), Buffer.from([0, 1, 2]));
    const read = readPreviousFile(repo);

    expect(
      await Promise.all([read("src/a.txt"), read("new/dir/missing.txt"), read("b.bin")])
    ).toEqual(["inside\n", null, undefined]);
  });

  test("never reads outside the working directory, directly or through a symlink", async () => {
    symlinkSync(join(dir, "outside", "src", "a.txt"), join(repo, "link.txt"));
    symlinkSync(join(dir, "outside"), join(repo, "out"));
    const read = readPreviousFile(repo);

    expect(
      await Promise.all([
        read(join(dir, "outside", "src", "a.txt")),
        read("../outside/src/a.txt"),
        read("link.txt"),
        read("out/src/a.txt"),
        read(join(dir, "elsewhere.txt")),
      ])
    ).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  test("a file swapped for a symlink out after the check is not followed", async () => {
    const file = join(repo, "src", "a.txt");

    const read = readPreviousFile(repo, {
      beforeOpen: async () => {
        rmSync(file);
        symlinkSync(join(dir, "outside", "src", "a.txt"), file);
      },
    });

    expect(await read("src/a.txt")).toBeUndefined();
  });

  test("a directory swapped for a symlink out after the check is caught once opened", async () => {
    const read = readPreviousFile(repo, {
      beforeOpen: async () => {
        renameSync(join(repo, "src"), join(repo, "src.old"));
        symlinkSync(join(dir, "outside", "src"), join(repo, "src"));
      },
    });

    expect(await read("src/a.txt")).toBeUndefined();
  });

  test("a file replaced after it was opened is not read", async () => {
    const read = readPreviousFile(repo, {
      afterOpen: async () => {
        writeFileSync(join(repo, "src", "b.txt"), "other\n");
        renameSync(join(repo, "src", "b.txt"), join(repo, "src", "a.txt"));
      },
    });

    expect(await read("src/a.txt")).toBeUndefined();
  });

  test.skipIf(process.platform === "win32")(
    "a FIFO swapped in after the check neither blocks nor is read",
    async () => {
      const file = join(repo, "src", "a.txt");

      const read = readPreviousFile(repo, {
        beforeOpen: async () => {
          rmSync(file);
          mkfifo(file);
        },
      });

      expect(await read("src/a.txt")).toBeUndefined();
    }
  );

  test("a file that grows past 1 MB while it is read is left unknown", async () => {
    const file = join(repo, "src", "a.txt");

    const read = readPreviousFile(repo, {
      afterOpen: async () => appendFileSync(file, "z".repeat(2 * 1024 * 1024)),
    });

    expect(await read("src/a.txt")).toBeUndefined();
  });
});

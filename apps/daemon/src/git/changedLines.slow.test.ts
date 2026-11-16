import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedLines } from "./changedLines.ts";
import { gitText } from "./git.ts";

const commit = async (repo: string, text: string) => {
  writeFileSync(join(repo, "src", "parse.ts"), text);
  await gitText(repo, ["add", "-A"]);
  await gitText(repo, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "c",
  ]);

  return gitText(repo, ["rev-parse", "HEAD"]);
};

test("the old side's changed spans of a repository-relative path, from a subdirectory", async () => {
  const repo = mkdtempSync(join(tmpdir(), "polaris-lines-"));
  mkdirSync(join(repo, "src"));
  await gitText(repo, ["init", "-q"]);
  const from = await commit(repo, "a\nb\nc\nd\ne\nf\n");
  const to = await commit(repo, "a\nB\nc\nd\nnew\ne\nf\n");

  const spans = await changedLines({ cwd: join(repo, "src"), from, to, path: "src/parse.ts" });

  expect(spans).toEqual([
    { start: 2, count: 1 },
    { start: 4, count: 0 },
  ]);
});

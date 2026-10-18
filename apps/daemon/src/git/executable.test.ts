import { expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { gitText } from "./git.ts";
import { plant, plantedNames, recorded } from "./planted.testing.ts";
import { makeRepo } from "./testing.ts";

test("the Daemon's git is the one on PATH, never a git planted in the repository it runs in", async () => {
  const root = await makeRepo();
  const names = plantedNames("git");
  appendFileSync(join(root, ".git/info/exclude"), `${[...names, "*.ran"].join("\n")}\n`);
  const planted = names.map((name) => plant(root, name));

  expect(await gitText(root, ["status", "--porcelain"])).toBe("");
  expect(planted.filter((p) => recorded(p) !== null)).toEqual([]);
}, 30_000);

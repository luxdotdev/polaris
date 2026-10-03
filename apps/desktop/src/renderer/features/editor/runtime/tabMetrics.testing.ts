import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { loadavg } from "node:os";
import * as candidate from "../model/tabs.ts";

type Model = Pick<
  typeof candidate,
  "emptyTabs" | "openTab" | "pinTab" | "cycleTab" | "closeTab" | "renameTab"
>;

const controlPath = process.argv[2];

const output = process.argv[3];

if (!controlPath || !output) throw new Error("Pass exact baseline tabs.ts path and output JSON");

// SAFETY: the control is the hash-recorded accepted tabs.ts; these six public source signatures are unchanged.
const control = (await import(controlPath)) as Model;

const sample = (model: Model) => {
  let set = model.emptyTabs;

  for (let index = 0; index < 20; index++) set = model.openTab(set, `/fixture/${index}.md`, false);
  const start = performance.now();

  for (let index = 0; index < 10000; index++) {
    set = model.cycleTab(set, 1);

    if (set.active !== null) set = model.pinTab(set, set.active);
  }

  const cycleMs = performance.now() - start;
  const changes = performance.now();

  for (let index = 0; index < 1000; index++) {
    set = model.openTab(set, "/fixture/transient.md", true);
    set = model.renameTab(set, "/fixture/transient.md", "/fixture/renamed.md");
    set = model.closeTab(set, "/fixture/renamed.md");
  }

  return { cycleMs, mutationsMs: performance.now() - changes, tabs: set.tabs.length };
};

sample(control);

sample(candidate);

const pairs = [];

for (let run = 0; run < 5; run++)
  pairs.push({ control: sample(control), candidate: sample(candidate) });

const source = await readFile(controlPath);

await writeFile(
  output,
  JSON.stringify(
    {
      controlSha256: createHash("sha256").update(source).digest("hex"),
      pairs,
      load: loadavg(),
      scope: "Warm pure source-tab operations; no renderer, whole-App, RSS or budget certification",
    },
    null,
    2
  )
);

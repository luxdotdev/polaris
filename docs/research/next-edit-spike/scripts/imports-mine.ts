// Mines extra add-import cases: a commit adds one new `import { … } from "…"` line to an existing
// file and uses those names in its other hunks. Deterministic: newest first, first N kept.
import { $ } from "bun";
import { diffEdits } from "../../../../packages/predict/src/edit/diff.ts";
import { apply, hunks, landing, REPO, show } from "./git.ts";

const limit = Number(process.argv[2] ?? 16);
const known = new Set(
  ((await Bun.file(new URL("./cases.json", import.meta.url)).json()) as { commit: string }[]).map((c) => c.commit)
);
const IMPORT = /^import (?:type )?\{([^}]+)\} from ["']([^"']+)["'];$/;
const log = (await $`git -C ${REPO} log --no-merges --format=%h -n 4000 --diff-filter=M -- '*.ts' '*.tsx'`.quiet().text())
  .split("\n").filter(Boolean);
const out = [];
for (const commit of log) {
  if (out.length >= limit) break;
  if ([...known].some((k) => commit.startsWith(k) || k.startsWith(commit))) continue;
  const files = (await $`git -C ${REPO} diff --name-only --diff-filter=M ${commit}^ ${commit}`.quiet().text())
    .split("\n").filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
  for (const path of files) {
    const all = await hunks(commit, path);
    if (all.length < 2 || all.length > 6) continue;
    const at = all.findIndex((h) => h.oldLines.length === 0 && h.newLines.length === 1 && IMPORT.test(h.newLines[0]!));
    if (at === -1) continue;
    const names = IMPORT.exec(all[at]!.newLines[0]!)![1]!.split(",").map((n) => n.replace(/^\s*type\s+/, "").trim()).filter(Boolean);
    const base = (await show(`${commit}^`, path)).split("\n");
    const used = (n: string) => new RegExp(`\\b${n.replace(/\$/g, "\\$")}\\b`);
    if (names.some((n) => base.some((l) => used(n).test(l)))) continue;
    const others = all.map((_, i) => i).filter((i) => i !== at);
    if (!names.every((n) => others.some((i) => all[i]!.newLines.some((l) => used(n).test(l))))) continue;
    const buffer = apply(base, all, others).join("\n");
    const history = others.map((i) => ({ line: landing(all, others, i), after: all[i]!.newLines.join("\n") }));
    out.push({ id: `xim${String(out.length + 1).padStart(2, "0")}`, commit, path, buffer, history,
      expected: diffEdits(buffer, apply(base, all, all.map((_, i) => i)).join("\n")) });
    break;
  }
}
await Bun.write(new URL("../reach/imports-extra.cases.json", import.meta.url), JSON.stringify(out) + "\n");
console.log(`Mined ${out.length} cases: ${out.map((c) => `${c.id} ${c.commit} ${c.path}`).join("\n")}`);

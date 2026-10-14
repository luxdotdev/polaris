// Lists candidate edit sequences from this repo's history: one TS file in one commit with
// 2–6 small hunks, at least two of them within 30 lines. Cases are hand-picked from this.
import { $ } from "bun";
import { REPO, hunks } from "./git.ts";

const limit = Number(process.argv[2] ?? 1100);
const log = await $`git -C ${REPO} log --no-merges -n ${limit} --format=%h%x09%s --numstat`.quiet().text();
let commit = "", subject = "";
const rows: string[] = [];
for (const line of log.split("\n")) {
  const head = /^([0-9a-f]{7,})\t(.*)$/.exec(line);
  if (head) { commit = head[1]!; subject = head[2]!; continue; }
  const stat = /^(\d+)\t(\d+)\t(.+\.tsx?)$/.exec(line);
  if (!stat) continue;
  const [add, del, path] = [Number(stat[1]), Number(stat[2]), stat[3]!];
  if (add + del > 60 || add + del < 2 || path.includes("=>")) continue;
  const hs = await hunks(commit, path).catch(() => []);
  if (hs.length < 2 || hs.length > 6 || hs.some((h) => h.oldLines.length > 8 || h.newLines.length > 8)) continue;
  const near = hs.some((h, i) => i > 0 && h.oldStart - hs[i - 1]!.oldStart <= 30);
  if (!near) continue;
  rows.push(`## ${commit} ${path} — ${subject}`);
  for (const h of hs) {
    rows.push(`  @${h.oldStart + 1}`);
    for (const l of h.oldLines) rows.push(`   -${l.slice(0, 110)}`);
    for (const l of h.newLines) rows.push(`   +${l.slice(0, 110)}`);
  }
}
console.log(rows.join("\n"));

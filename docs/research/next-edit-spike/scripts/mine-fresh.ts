// Mines a fresh held-out set by edit shape only (no model output is read): commits disjoint
// from cases.json, one case per file, five categories, picked by sha256("hc1:<commit>:<path>").
import { $ } from "bun";
import { createHash } from "node:crypto";
import { REPO, hunks, landing, type Hunk } from "./git.ts";

// mine-fresh.ts [per category] [salt] [id prefix] [excluded manifest…]; defaults reproduce fresh-cases.json.
const [per = "12", SALT = "hc1", PREFIX = "f", ...excluded] = process.argv.slice(2);
const PER_CATEGORY = Number(per);
// Size limits; the defaults are the first fresh set's.
const MAX_LINES = Number(process.env.MINE_MAX_LINES ?? 60), MAX_HUNKS = Number(process.env.MINE_MAX_HUNKS ?? 6);
const manifests = excluded.length ? excluded : ["cases.json"];
const used = new Set<string>();
for (const m of manifests) for (const c of (await Bun.file(new URL(`./${m}`, import.meta.url)).json()) as { commit: string }[]) used.add(c.commit.slice(0, 7));
const log = await $`git -C ${REPO} log --no-merges --format=%h%x09%s --numstat`.quiet().text();
const ids = (s: string) => s.match(/[A-Za-z_$][\w$]*/g) ?? [];
const isImport = (l: string) => /^\s*(import\b|export\s+\{[^}]*\}\s+from|\}\s+from\s+["']|[\w$]+,?$|type\s+[\w$]+,?$)/.test(l.trim()) || l.trim() === "";
const code = (l: string) => l.trim() && !/^\s*(\/\/|\*|\/\*)/.test(l);

function renamePair(a: string, b: string) {
  const x = ids(a), y = ids(b);
  if (x.length !== y.length) return null;
  const d = new Set(x.map((t, i) => [t, y[i]] as const).filter(([p, q]) => p !== q).map(([p, q]) => `${p}>${q}`));
  return d.size === 1 ? [...d][0]! : null;
}

const shape = (h: Hunk) => h.newLines.filter((l) => !h.oldLines.includes(l)).map((l) => l.trim().replace(/[A-Za-z_$][\w$]*/g, "x")).join("|");

function categorise(hs: Hunk[]): { cat: string; target: number; typed?: number } | null {
  const others = (t: number) => hs.filter((_, i) => i !== t);
  for (let t = 0; t < hs.length; t++) {
    const h = hs[t]!;
    if (!h.newLines.length || !h.newLines.some((l) => /^import\b/.test(l)) || !h.newLines.every(isImport) || !h.oldLines.every((l) => /import|from|^\s*[\w$]+,?$/.test(l))) continue;
    const added = new Set(ids(h.newLines.join(" ")).filter((n) => !ids(h.oldLines.join(" ")).includes(n) && !["import", "from", "type"].includes(n)));
    if (others(t).some((o) => o.newLines.some((l) => ids(l).some((n) => added.has(n))))) return { cat: "import", target: t };
  }
  for (let t = 0; t < hs.length; t++) {
    const h = hs[t]!;
    if (h.newLines.length || !h.oldLines.some(code) || h.oldLines.some((l) => /^import\b/.test(l))) continue;
    if (others(t).some((o) => o.newLines.some(code))) return { cat: "dead-code", target: t };
  }
  const pairs = hs.map((h) => h.oldLines.length && h.oldLines.length === h.newLines.length ? new Set(h.oldLines.map((o, i) => renamePair(o, h.newLines[i]!)).filter(Boolean)) : new Set());
  for (const p of new Set(pairs.flatMap((s) => [...s]))) {
    const with_ = pairs.map((s, i) => (s.has(p) ? i : -1)).filter((i) => i >= 0);
    if (with_.length >= 2) return { cat: "rename", target: with_[1]! };
  }
  const shapes = hs.map(shape);
  for (let t = 1; t < hs.length; t++) if (shapes[t] && shapes.indexOf(shapes[t]!) < t) return { cat: "refactor", target: t };
  for (let t = 0; t < hs.length; t++) {
    const h = hs[t]!;
    if (h.oldLines.length || h.newLines.length < 2 || h.newLines.some((l) => /^import\b/.test(l)) || h.newLines[0]!.trim().length < 10) continue;
    if (others(t).some((o) => o.newLines.some(code))) return { cat: "insertion", target: t, typed: 0.4 };
  }
  return null;
}

let commit = "";
const found: Record<string, { id?: string; cat: string; commit: string; path: string; hist: number[]; target: number[]; typed?: number; key: string }[]> = {};
for (const line of log.split("\n")) {
  const head = /^([0-9a-f]{7,})\t/.exec(line);
  if (head) { commit = head[1]!.slice(0, 8); continue; }
  const stat = /^(\d+)\t(\d+)\t(.+\.tsx?)$/.exec(line);
  if (!stat || used.has(commit.slice(0, 7))) continue;
  const [add, del, path] = [Number(stat[1]), Number(stat[2]), stat[3]!];
  if (add + del > MAX_LINES || add + del < 2 || path.includes("=>") || /\.test\.tsx?$|\.d\.ts$|fixtures?\//.test(path)) continue;
  const hs = await hunks(commit, path).catch(() => []);
  if (hs.length < 2 || hs.length > MAX_HUNKS || hs.some((h) => h.oldLines.length > 8 || h.newLines.length > 8)) continue;
  const c = categorise(hs);
  if (!c) continue;
  const hist = hs.map((_, i) => i).filter((i) => i !== c.target);
  // Keep the target within 40 lines of the cursor (the end of the last history hunk).
  const cursorAt = landing(hs, hist, hist.at(-1)!) + hs[hist.at(-1)!]!.newLines.length;
  if (Math.abs(landing(hs, hist, c.target) - cursorAt) > 40) continue;
  const key = createHash("sha256").update(`${SALT}:${commit}:${path}`).digest("hex");
  (found[c.cat] ??= []).push({ cat: c.cat, commit, path, hist, target: [c.target], ...(c.typed ? { typed: c.typed } : {}), key });
}
const prefix: Record<string, string> = { rename: "rn", refactor: "rf", "dead-code": "dd", import: "im", insertion: "in" };
const out = [];
for (const [cat, list] of Object.entries(found)) {
  const seen = new Set<string>();
  const picked = list.sort((a, b) => a.key.localeCompare(b.key)).filter((c) => !seen.has(c.commit) && seen.add(c.commit)).slice(0, PER_CATEGORY);
  process.stderr.write(`${cat}: ${list.length} candidates, ${picked.length} picked\n`);
  picked.forEach(({ key: _, ...c }, i) => out.push({ id: `${PREFIX}${prefix[cat]}${String(i + 1).padStart(2, "0")}`, ...c, split: PREFIX === "f" ? "fresh" : "fresh2" }));
}
console.log(JSON.stringify(out, null, 1));

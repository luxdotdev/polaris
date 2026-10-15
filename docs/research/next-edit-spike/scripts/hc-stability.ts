// hc-stability.ts <tag> <variant>: would abstaining when the previous keystroke's prediction
// disagrees remove wrong shown edits without losing useful ones? Needs <tag>.devprev.json.
import { applyEdits } from "../../../../packages/predict/src/edit/guards.ts";
import { loadLabels, loadSet, normalized, previousKeystroke, rawDir, score, variantOf, type Output } from "./hc-lib.ts";

const [tag = "", name = tag] = process.argv.slice(2);
const variant = variantOf(name);
const labels = await loadLabels();
const read = async (set: string): Promise<Output[]> => Bun.file(new URL(`${tag}.${set}.json`, rawDir)).json();
const now = await read("dev"), before = await read("devprev");
const table: Record<string, string[]> = {};
for (const c of await loadSet("dev")) {
  const cur = score(c, now.find((o) => o.id === c.id)!, variant, labels);
  if (!cur.edits.length) continue;
  const p = previousKeystroke(c);
  if (!p) { (table[`${cur.label} no-prev`] ??= []).push(c.id); continue; }
  const prev = score(p, before.find((o) => o.id === c.id)!, variant, labels);
  const typed = c.buffer[c.cursor - 1]!;
  const spans = prev.edits.some((e) => e.from < p.cursor && e.to > p.cursor);
  const moved = prev.edits.map((e) => (e.from >= p.cursor ? { ...e, from: e.from + 1, to: e.to + 1 } : e));
  const agree = prev.edits.length > 0 && (normalized(prev.shown) === normalized(cur.shown) ||
    (!spans && normalized(applyEdits(c.buffer, moved)) === normalized(cur.shown)));
  void typed;
  (table[`${cur.label} ${agree ? "stable" : prev.edits.length ? "changed" : "prev-abstained"}`] ??= []).push(c.id);
}
for (const [k, v] of Object.entries(table).sort()) console.log(k.padEnd(28), v.length, v.join(" "));

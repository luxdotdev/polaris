// Tags mined candidates (mine.ts output) by edit shape, to hand-pick a balanced case set.
const text = await Bun.file(process.argv[2]!).text();
type H = { at: number; old: string[]; neu: string[] };
const blocks = text.split(/^## /m).slice(1).map((b) => {
  const [head, ...rest] = b.split("\n");
  const hs: H[] = [];
  for (const l of rest) {
    const m = /^  @(\d+)/.exec(l);
    if (m) hs.push({ at: Number(m[1]), old: [], neu: [] });
    else if (l.startsWith("   -")) hs.at(-1)!.old.push(l.slice(4));
    else if (l.startsWith("   +")) hs.at(-1)!.neu.push(l.slice(4));
  }
  return { head: head!, hs };
});
const ids = (s: string) => s.match(/[A-Za-z_$][\w$]*/g) ?? [];
function renamePair(a: string, b: string) {
  const x = ids(a), y = ids(b);
  if (x.length !== y.length) return null;
  const d = x.map((t, i) => [t, y[i]] as const).filter(([p, q]) => p !== q);
  const u = new Set(d.map(([p, q]) => p + ">" + q));
  return u.size === 1 && a.replace(/\s/g, "").length > 0 ? [...u][0]! : null;
}
const tags: Record<string, string[]> = { rename: [], deadDelete: [], importAdd: [], insertion: [], repeat: [] };
for (const { head, hs } of blocks) {
  if (/\.test\.tsx?/.test(head)) continue;
  const pairs = hs.filter((h) => h.old.length === h.neu.length && h.old.length > 0).flatMap((h) => h.old.map((o, i) => renamePair(o, h.neu[i]!)));
  const counts = new Map<string, number>();
  for (const p of pairs) if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  if ([...counts.values()].some((n) => n >= 2)) tags.rename!.push(head);
  if (hs.some((h) => h.neu.length === 0 && h.old.length >= 1 && !h.old.every((l) => !l.trim())) && hs.some((h) => h.neu.length > 0)) tags.deadDelete!.push(head);
  if (hs.some((h) => h.neu.some((l) => /^import /.test(l)) && !h.old.some((l) => /^import /.test(l))) && hs.some((h) => h.at < 40 + hs[0]!.at && !h.neu.some((l) => /^import/.test(l)))) tags.importAdd!.push(head);
  if (hs.some((h) => h.old.length === 0 && h.neu.length >= 2 && !h.neu.some((l) => /^import/.test(l)))) tags.insertion!.push(head);
  const shapes = hs.map((h) => h.neu.filter((l) => !h.old.includes(l)).map((l) => l.trim().replace(/[A-Za-z_$][\w$]*/g, "x")).join("|")).filter(Boolean);
  if (shapes.length >= 2 && new Set(shapes).size < shapes.length) tags.repeat!.push(head);
}
for (const [k, v] of Object.entries(tags)) console.log(k, v.length);
console.log(JSON.stringify(tags, null, 1));

// Where each case's target lies relative to the cursor, and whether each format's window covers it.
import { changed, loadCases } from "./build.ts";
import { sweep, zeta } from "./prompts.ts";
for (const c of await loadCases()) {
  const s = c.steps.at(-1)!;
  const cur = s.states.at(-1)!;
  const [p, ea] = changed(cur, c.expected);
  const inW = (w: [number, number]) => (p >= w[0] && Math.max(ea, p + 1) <= w[1] ? "in" : "OUT");
  console.log(c.id.padEnd(5), c.cat.padEnd(10), "cursor", s.cursorLine, "target", p, "-", ea, "dist", p - s.cursorLine, "zeta", inW(zeta(c, s).window), "sweep", inW(sweep(c, s).window), "lines", cur.length);
}

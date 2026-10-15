// perf-table.ts <latency.jsonl>: p50/p90/p95 of time to Final and first token, per run and pooled,
// for "file" (first request in a file) and "keystroke" (after the keystroke before), and shares under thresholds.
type Timing = { error: string | null; finalMs: number | null; firstTokenMs: number | null; promptMs: number | null; totalMs: number; edits: number };
type Row = { run: number; id: string; load: number; file: Timing; keystroke: Timing | null };

const rows = (await Bun.file(process.argv[2]!).text()).trim().split("\n").map((l) => JSON.parse(l) as Row);
const q = (xs: number[], p: number) => {
  const s = xs.toSorted((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]!) : NaN;
};
const share = (xs: number[], ms: number) => `${Math.round((100 * xs.filter((x) => x <= ms).length) / xs.length)}%`;
const loads = (rs: Row[]) => `${Math.min(...rs.map((r) => r.load))}–${Math.max(...rs.map((r) => r.load))}`;

const line = (label: string, ts: Timing[], rs: Row[]) => {
  const ok = ts.filter((t) => t.error === null && t.finalMs !== null);
  const fin = ok.map((t) => t.finalMs!), ft = ok.map((t) => t.firstTokenMs!).filter((x) => x !== null);
  return `| ${label} | ${ok.length}/${ts.length} | ${q(fin, 0.5)} / ${q(fin, 0.9)} / ${q(fin, 0.95)} | ${q(ft, 0.5)} / ${q(ft, 0.9)} / ${q(ft, 0.95)} | ${share(fin, 300)} | ${share(fin, 500)} | ${share(fin, 1000)} | ${loads(rs)} |`;
};

console.log("| Set | Finals | Final p50 / p90 / p95 ms | First token p50 / p90 / p95 ms | ≤ 300 ms | ≤ 500 ms | ≤ 1 s | Load (1 min) |");
console.log("|---|---:|---:|---:|---:|---:|---:|---|");
const runs = [...new Set(rows.map((r) => r.run))];
for (const kind of ["file", "keystroke"] as const) {
  for (const run of runs) {
    const rs = rows.filter((r) => r.run === run && r[kind]);
    console.log(line(`${kind}, run ${run}`, rs.map((r) => r[kind]!), rs));
  }
  const rs = rows.filter((r) => r[kind]);
  console.log(line(`**${kind}, all runs**`, rs.map((r) => r[kind]!), rs));
}
const errors = rows.flatMap((r) => [r.file, r.keystroke]).filter((t) => t?.error);
console.log(`\nNo Final (errors): ${errors.length}; ${[...new Set(errors.map((e) => e!.error))].join("; ")}`);

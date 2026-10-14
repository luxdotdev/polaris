// score.ts <tag…>: latency summary and automatic quality labels for each run, plus a review
// file (raw/<tag>.review.md) of every non-exact output for hand judgement.
import { changed, loadCases } from "./build.ts";
import { FORMATS, type Format } from "./prompts.ts";

const raw = new URL("../raw/", import.meta.url).pathname;
const cases = new Map((await loadCases()).map((c) => [c.id, c]));
const norm = (lines: string[]) => lines.join("\n").replace(/\s+/g, "");
const counts = (lines: string[]) => {
  const m = new Map<string, number>();
  for (const l of lines.map((x) => x.trim()).filter(Boolean)) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
};
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : NaN;
};
const med = (xs: number[]) => pct(xs, 0.5);

function hunkText(a: string[], b: string[]) {
  const [p, ea, eb] = changed(a, b);
  return [`@@ line ${p + 1}`, ...a.slice(p, ea).map((l) => "-" + l), ...b.slice(p, eb).map((l) => "+" + l)].join("\n");
}

const summary: string[] = [];
for (const tag of process.argv.slice(2)) {
  const meta = await Bun.file(`${raw}${tag}.meta.json`).json();
  const fmt = meta.fmt as Format;
  const rows = (await Bun.file(`${raw}${tag}.jsonl`).text()).trim().split("\n").map((l) => JSON.parse(l));
  const cold = rows.filter((r) => r.step === 0);
  const warm = rows.filter((r) => r.step > 0);
  const srv = (r: any) => r.timings.prompt_ms + r.timings.predicted_ms;
  const draftN = rows.reduce((n, r) => n + (r.timings.draft_n ?? 0), 0);
  const draftA = rows.reduce((n, r) => n + (r.timings.draft_n_accepted ?? 0), 0);

  const labels: Record<string, number> = { exact: 0, abstain: 0, other: 0, inWindow: 0, exactInWindow: 0, deletesHealthy: 0, reverts: 0, noiseOutOfWindow: 0 };
  const review: string[] = [`# ${tag} (${fmt}) — non-exact outputs at the scored step`];
  const perCase: Record<string, string> = {};
  for (const r of rows.filter((x) => x.step === 4)) {
    const c = cases.get(r.id)!;
    const s = c.steps[4]!;
    const cur = s.states.at(-1)!;
    const built = FORMATS[fmt](c, s);
    const pred = built.apply(r.content);
    const [p, ea] = changed(cur, c.expected);
    const inWin = p >= built.window[0] && Math.max(ea, p + 1) <= built.window[1];
    if (inWin) labels.inWindow!++;
    let label: string;
    if (!pred || norm(pred) === norm(cur)) label = "abstain";
    else if (c.allowed.some((a) => norm(a) === norm(pred))) label = "exact";
    else label = "other";
    labels[label]!++;
    if (label === "exact" && inWin) labels.exactInWindow!++;
    const flags: string[] = [];
    if (pred && label !== "exact" && label !== "abstain") {
      const cc = counts(cur), cp = counts(pred), ce = counts(c.expected);
      for (const [l, n] of cc) if ((cp.get(l) ?? 0) < n && (ce.get(l) ?? 0) >= n && l.length > 2) { flags.push("deletes-healthy"); break; }
      const old = new Set(c.hist.flatMap((h) => c.all[h]!.oldLines.map((x) => x.trim()).filter(Boolean)));
      for (const l of old) if ((cp.get(l) ?? 0) > (cc.get(l) ?? 0)) { flags.push("reverts-user-edit"); break; }
      if (!inWin) flags.push("noise-out-of-window");
      if (flags.includes("deletes-healthy")) labels.deletesHealthy!++;
      if (flags.includes("reverts-user-edit")) labels.reverts!++;
      if (!inWin) labels.noiseOutOfWindow!++;
      review.push(`\n## ${c.id} ${c.cat} ${inWin ? "in-window" : "OUT-of-window"} ${flags.join(" ")}\nexpected:\n\`\`\`diff\n${hunkText(cur, c.expected)}\n\`\`\`\npredicted:\n\`\`\`diff\n${hunkText(cur, pred)}\n\`\`\``);
    }
    perCase[c.id] = label + (flags.length ? `(${flags.join(",")})` : "") + (inWin ? "" : "[out]");
  }
  await Bun.write(`${raw}${tag}.review.md`, review.join("\n") + "\n");
  await Bun.write(`${raw}${tag}.labels.json`, JSON.stringify(perCase, null, 1));
  const mem = meta.memory ? `${(meta.memory.rssBytes / 2 ** 30).toFixed(2)} GiB` : "shared";
  summary.push(
    `| ${tag} | ${Math.round(med(warm.map(srv)))} / ${Math.round(pct(warm.map(srv), 0.9))} | ${Math.round(med(warm.map((r) => r.wallMs)))} | ${Math.round(med(cold.map((r) => r.timings.prompt_ms)))} (${Math.round(med(cold.map((r) => r.timings.prompt_n)))} tok) | ${Math.round(med(warm.map((r) => r.timings.prompt_n)))} | ${med(rows.map((r) => r.timings.predicted_n))} | ${Math.round(med(rows.map((r) => r.timings.predicted_per_second)))} | ${draftN ? Math.round((100 * draftA) / draftN) + "%" : "–"} | ${labels.exact}/${rows.length / 5} | ${labels.exactInWindow}/${labels.inWindow} | ${labels.abstain} | ${labels.deletesHealthy} | ${labels.reverts} | ${mem} | ${meta.load} |`
  );
}
console.log("| run | warm server ms p50/p90 | warm wall p50 | cold prompt ms (tokens) | warm prompt tok | out tok | tok/s | draft acc | exact | exact in-window | abstain | deletes-healthy | reverts | RSS | load |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
console.log(summary.join("\n"));

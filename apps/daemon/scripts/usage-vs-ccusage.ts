/**
 * Compares the Usage index with ccusage on this Host's real logs, per UTC day
 * (M1.5 acceptance: token totals match within ccusage's dedup rules):
 *
 *   bun --cwd apps/daemon scripts/usage-vs-ccusage.ts [--until YYYY-MM-DD] [--db path]
 *
 * Days from `--until` on (default: today, UTC) are left out: sessions still
 * running write to them between the two reads. Runs ccusage 20.0.26 (the
 * version at the pinned commit) through `bunx`, offline, reading the same logs.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { openUsageDb } from "../src/usage/db.ts";
import { discoverLogs, indexLogs } from "../src/usage/indexer.ts";
import { writerOver } from "../src/usage/writer.ts";

const CCUSAGE = "ccusage@20.0.26";

const argument = (name: string) => {
  const at = process.argv.indexOf(name);

  return at === -1 ? null : (process.argv[at + 1] ?? null);
};

const until = argument("--until") ?? new Date().toISOString().slice(0, 10);

const dir = mkdtempSync(join(tmpdir(), "polaris-usage-compare-"));

const dbPath = argument("--db") ?? join(dir, "usage.sqlite");

interface Totals {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

const Day = Schema.Struct({
  date: Schema.String,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheCreationTokens: Schema.Number,
  cacheReadTokens: Schema.Number,
});

const Daily = Schema.fromJsonString(Schema.Struct({ daily: Schema.Array(Day) }));

const ccusage = (harness: "claude" | "codex"): Map<string, Totals> => {
  const run = spawnSync(
    "bunx",
    [CCUSAGE, harness, "daily", "--json", "--timezone", "UTC", "--offline"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
  );

  const report = Schema.decodeUnknownSync(Daily)(run.stdout);

  return new Map(
    report.daily.map((day) => [
      day.date,
      {
        input: day.inputTokens,
        cacheRead: day.cacheReadTokens,
        cacheWrite: day.cacheCreationTokens,
        output: day.outputTokens,
      },
    ])
  );
};

const total = (t: Totals) => t.input + t.cacheRead + t.cacheWrite + t.output;

const started = performance.now();

const db = openUsageDb(dbPath);

const writer = writerOver(db);

const files = discoverLogs(process.env, ["claude", "codex"]);

await indexLogs(writer, files);

const buildMs = performance.now() - started;

const ours = (harness: string): Map<string, Totals> => {
  const rows = db
    .query<Totals & { day: string }, [string]>(
      `SELECT strftime('%Y-%m-%d', hour / 1000, 'unixepoch') AS day, SUM(input) AS input,
       SUM(cache_read) AS cacheRead, SUM(cache_write) AS cacheWrite, SUM(output) AS output
       FROM usage WHERE harness = ? GROUP BY day`
    )
    .all(harness);

  return new Map(rows.map(({ day, ...totals }) => [day, totals]));
};

let failed = false;

for (const harness of ["claude", "codex"] as const) {
  const theirs = ccusage(harness);
  const mine = ours(harness);
  const days = [...new Set([...theirs.keys(), ...mine.keys()])].filter((d) => d < until).sort();
  const zero = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  let theirTotal = 0;
  let myTotal = 0;
  const differing: Array<string> = [];

  for (const day of days) {
    const a = theirs.get(day) ?? zero;
    const b = mine.get(day) ?? zero;
    theirTotal += total(a);
    myTotal += total(b);

    if (JSON.stringify(a) !== JSON.stringify(b))
      differing.push(
        `  ${day}  ccusage ${JSON.stringify(a)}\n              polaris ${JSON.stringify(b)}`
      );
  }

  const diff = myTotal - theirTotal;
  const pct = theirTotal === 0 ? 0 : (diff / theirTotal) * 100;

  console.log(
    `${harness}: ${days.length} days before ${until}; ccusage ${theirTotal.toLocaleString()} tokens, ` +
      `polaris ${myTotal.toLocaleString()} (diff ${diff.toLocaleString()}, ${pct.toFixed(4)}%); ` +
      `${differing.length} days differ`
  );

  for (const line of differing.slice(0, 10)) console.log(line);

  if (differing.length > 0) failed = true;
}

const rows = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM usage").get()?.n ?? 0;

console.log(
  `index: ${files.length} files, ${rows.toLocaleString()} rows, built in ${(buildMs / 1000).toFixed(1)} s` +
    `, peak RSS ${(process.resourceUsage().maxRSS / 2 ** 20).toFixed(0)} MiB`
);

db.close();

if (argument("--db") === null) rmSync(dir, { recursive: true, force: true });

process.exit(failed ? 1 : 0);

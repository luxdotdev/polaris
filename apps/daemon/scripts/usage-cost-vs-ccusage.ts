/**
 * Compares the Client's cost estimates with ccusage's on this Host's real logs,
 * per UTC day and per Model:
 *
 *   bun --cwd apps/daemon scripts/usage-cost-vs-ccusage.ts [--until YYYY-MM-DD]
 *
 * Both sides price with today's lists: the Client fetches LiteLLM and
 * models.dev like `PriceBook.refresh`, and ccusage 20.0.26 runs online. Days
 * from `--until` on (default: today, UTC) are left out.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bucketCost, buildPriceTable, LITELLM_URL, MODELS_DEV_URL } from "@polaris/client/usage";
import { Schema } from "effect";
import { openUsageDb } from "../src/usage/db.ts";
import { discoverLogs, indexLogs } from "../src/usage/indexer.ts";
import { queryBuckets } from "../src/usage/query.ts";
import { writerOver } from "../src/usage/writer.ts";

const CCUSAGE = "ccusage@20.0.26";

const argument = (name: string) => {
  const at = process.argv.indexOf(name);

  return at === -1 ? null : (process.argv[at + 1] ?? null);
};

const until = argument("--until") ?? new Date().toISOString().slice(0, 10);

const ClaudeDay = Schema.Struct({
  date: Schema.String,
  totalCost: Schema.Number,
  modelBreakdowns: Schema.Array(Schema.Struct({ modelName: Schema.String, cost: Schema.Number })),
});

const CodexDay = Schema.Struct({
  date: Schema.String,
  costUSD: Schema.Number,
  models: Schema.Record(Schema.String, Schema.Unknown),
});

const ccusage = (harness: "claude" | "codex") => {
  const run = spawnSync("bunx", [CCUSAGE, harness, "daily", "--json", "--timezone", "UTC"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  return run.stdout;
};

const claudeDays = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ daily: Schema.Array(ClaudeDay) }))
)(ccusage("claude")).daily;

const codexDays = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ daily: Schema.Array(CodexDay) }))
)(ccusage("codex")).daily;

const get = async (url: string) => (await fetch(url)).text();

const prices = buildPriceTable(
  await get(LITELLM_URL),
  await get(MODELS_DEV_URL),
  new Date().toISOString()
);

const dir = mkdtempSync(join(tmpdir(), "polaris-cost-compare-"));

const db = openUsageDb(join(dir, "usage.sqlite"));

await indexLogs(writerOver(db), discoverLogs(process.env, ["claude", "codex"]));

const buckets = queryBuckets(db, {
  from: 0,
  to: Date.parse(until),
  harness: null,
  sessionId: null,
});

db.close();

rmSync(dir, { recursive: true, force: true });

const ours = new Map<string, number>();

const oursByModel = new Map<string, number>();

const unpriced = new Map<string, number>();

for (const bucket of buckets) {
  const cost = bucketCost(bucket, prices);
  const day = `${bucket.harness} ${bucket.hour.slice(0, 10)}`;
  ours.set(day, (ours.get(day) ?? 0) + cost.usd);
  const model = `${bucket.harness} ${bucket.model}`;
  oursByModel.set(model, (oursByModel.get(model) ?? 0) + cost.usd);

  if (cost.unpricedTokens > 0)
    unpriced.set(model, (unpriced.get(model) ?? 0) + cost.unpricedTokens);
}

const theirs = new Map<string, number>();

for (const day of claudeDays) if (day.date < until) theirs.set(`claude ${day.date}`, day.totalCost);

for (const day of codexDays) if (day.date < until) theirs.set(`codex ${day.date}`, day.costUSD);

const theirsByModel = new Map<string, number>();

for (const day of claudeDays.filter((d) => d.date < until))
  for (const m of day.modelBreakdowns)
    theirsByModel.set(
      `claude ${m.modelName}`,
      (theirsByModel.get(`claude ${m.modelName}`) ?? 0) + m.cost
    );

const money = (n: number) => `$${n.toFixed(2)}`;

for (const harness of ["claude", "codex"]) {
  const days = [...new Set([...theirs.keys(), ...ours.keys()])]
    .filter((k) => k.startsWith(harness))
    .sort();

  let a = 0;
  let b = 0;
  const worst: Array<[string, number, number]> = [];

  for (const day of days) {
    const t = theirs.get(day) ?? 0;
    const o = ours.get(day) ?? 0;
    a += t;
    b += o;
    worst.push([day, t, o]);
  }

  worst.sort((x, y) => Math.abs(y[2] - y[1]) - Math.abs(x[2] - x[1]));
  const pct = a === 0 ? 0 : ((b - a) / a) * 100;

  console.log(
    `${harness}: ${days.length} days before ${until}; ccusage ${money(a)}, polaris ${money(b)} (diff ${money(b - a)}, ${pct.toFixed(3)}%)`
  );

  for (const [day, t, o] of worst.slice(0, 5).filter(([, t, o]) => Math.abs(o - t) >= 0.01))
    console.log(`  ${day}: ccusage ${money(t)}, polaris ${money(o)}`);
}

console.log("per Model (Claude from ccusage's breakdown; Codex ccusage reports per day only):");

for (const [model, cost] of [...oursByModel].sort((x, y) => y[1] - x[1])) {
  const t = theirsByModel.get(model);
  console.log(
    `  ${model}: polaris ${money(cost)}${t === undefined ? "" : `, ccusage ${money(t)}`}`
  );
}

if (unpriced.size > 0)
  console.log(
    `unpriced: ${[...unpriced].map(([m, n]) => `${m} (${n.toLocaleString()} tokens)`).join(", ")}`
  );

console.log(`prices: ${Object.keys(prices.models).length} Models, fetched ${prices.fetchedAt}`);

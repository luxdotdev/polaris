#!/usr/bin/env bun
/**
 * Daemon benchmarks. See packages/bench/README.md.
 *
 *   bun run bench [scenario...] [--quick] [--runs N] [--json out.json]
 *                 [--compare baseline.json] [--fail-on kinds] [--save-baseline]
 *                 [--markdown out.md] [--profile] [--binary path] [--transport bridge|socket]
 *                 [--list]
 *
 * Relative paths are resolved against the repository root.
 */
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { type Comparison, compare } from "./compare.ts";
import { REPO_ROOT, type TransportKind } from "./daemon.ts";
import { environment } from "./env.ts";
import { renderComparison, renderMarkdown, renderResult } from "./report.ts";
import { runScenario } from "./runner.ts";
import { SCENARIOS } from "./scenarios/index.ts";
import type { BenchResult, MetricKind, ScenarioResult } from "./types.ts";

const ALL_KINDS: ReadonlyArray<MetricKind> = [
  "memory",
  "cpu",
  "latency",
  "time",
  "throughput",
  "count",
];
export const BENCH_DIR = resolve(import.meta.dir, "..");

const usage = `usage: bun run bench [scenario...] [options]

scenarios: ${SCENARIOS.map((s) => s.name).join(", ")} (default: all)

  --quick               smaller sizes, for CI and quick checks
  --runs N              runs per scenario, each with fresh Daemons (default 1); medians are reported
  --json PATH           also write the result JSON to PATH
  --compare PATH        compare with a baseline; exit 1 on regressions beyond tolerance
  --fail-on KINDS       comma-separated kinds that gate --compare (default: all):
                        ${ALL_KINDS.join(",")}
  --save-baseline       write the result to packages/bench/baselines/<machine>.json
  --markdown PATH       append a Markdown summary to PATH (e.g. $GITHUB_STEP_SUMMARY)
  --profile             CPU profile + heap snapshot at peak for each scenario run
  --binary PATH         bench a compiled polaris binary instead of the source
  --transport KIND      bridge (default: polaris bridge, like ssh) or socket (direct)
  --list                list scenarios and exit`;

interface Args {
  scenarios: Array<string>;
  quick: boolean;
  runs: number;
  json: string | null;
  compare: string | null;
  failOn: Set<MetricKind>;
  saveBaseline: boolean;
  markdown: string | null;
  profile: boolean;
  binary: string | null;
  transport: TransportKind;
  list: boolean;
}

const fromRoot = (path: string) => (isAbsolute(path) ? path : join(REPO_ROOT, path));

const parseArgs = (argv: ReadonlyArray<string>): Args => {
  const args: Args = {
    scenarios: [],
    quick: false,
    runs: 1,
    json: null,
    compare: null,
    failOn: new Set(ALL_KINDS),
    saveBaseline: false,
    markdown: null,
    profile: false,
    binary: null,
    transport: "bridge",
    list: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case "--quick":
        args.quick = true;
        break;
      case "--runs":
        args.runs = Math.max(1, Number.parseInt(value(), 10) || 1);
        break;
      case "--json":
        args.json = fromRoot(value());
        break;
      case "--compare":
        args.compare = fromRoot(value());
        break;
      case "--fail-on": {
        const kinds = value()
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
        for (const k of kinds) {
          if (!ALL_KINDS.includes(k as MetricKind) && k !== "none")
            throw new Error(`unknown kind ${k}`);
        }
        args.failOn = new Set(kinds.filter((k) => k !== "none") as Array<MetricKind>);
        break;
      }
      case "--save-baseline":
        args.saveBaseline = true;
        break;
      case "--markdown":
        args.markdown = fromRoot(value());
        break;
      case "--profile":
        args.profile = true;
        break;
      case "--binary":
        args.binary = fromRoot(value());
        break;
      case "--transport": {
        const t = value();
        if (t !== "bridge" && t !== "socket") throw new Error(`unknown transport ${t}`);
        args.transport = t;
        break;
      }
      case "--list":
        args.list = true;
        break;
      case "-h":
      case "--help":
        console.log(usage);
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
        args.scenarios.push(arg);
    }
  }
  return args;
};

const main = async () => {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${usage}`);
    return 2;
  }
  if (args.list) {
    for (const s of SCENARIOS) console.log(`${s.name.padEnd(12)} ${s.description}`);
    return 0;
  }
  const unknown = args.scenarios.filter((name) => !SCENARIOS.some((s) => s.name === name));
  if (unknown.length > 0) {
    console.error(`unknown scenario(s): ${unknown.join(", ")}\n\n${usage}`);
    return 2;
  }
  const selected =
    args.scenarios.length === 0
      ? SCENARIOS
      : SCENARIOS.filter((s) => args.scenarios.includes(s.name));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(BENCH_DIR, "results", stamp);
  mkdirSync(runDir, { recursive: true });
  const started = performance.now();
  const log = (message: string) =>
    process.stderr.write(
      `[bench ${((performance.now() - started) / 1000).toFixed(1)}s] ${message}\n`
    );

  const env = environment({ binary: args.binary, transport: args.transport });
  log(`${env.machine} (${env.cpu}), ${env.daemon} Daemon, results in ${runDir}`);

  const scenarios: Record<string, ScenarioResult> = {};
  for (const scenario of selected) {
    scenarios[scenario.name] = await runScenario(scenario, {
      quick: args.quick,
      runs: args.runs,
      binary: args.binary,
      transport: args.transport,
      profileRoot: args.profile ? runDir : null,
      log,
    });
  }

  const result: BenchResult = {
    schema: 1,
    env,
    options: {
      quick: args.quick,
      runs: args.runs,
      profile: args.profile,
      scenarios: selected.map((s) => s.name),
    },
    scenarios,
  };
  const resultPath = join(runDir, "result.json");
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  if (args.json) {
    mkdirSync(dirname(args.json), { recursive: true });
    copyFileSync(resultPath, args.json);
  }
  if (args.saveBaseline) {
    const baselinePath = join(
      BENCH_DIR,
      "baselines",
      `${env.machineSlug}${args.quick ? "-quick" : ""}.json`
    );
    copyFileSync(resultPath, baselinePath);
    log(`baseline written to ${baselinePath}`);
  }

  const text = renderResult(result);
  console.log(text);
  writeFileSync(join(runDir, "summary.txt"), `${text}\n`);

  let comparison: Comparison | null = null;
  if (args.compare) {
    const baseline = JSON.parse(readFileSync(args.compare, "utf8")) as BenchResult;
    comparison = compare(baseline, result, args.failOn);
    const rendered = renderComparison(comparison);
    console.log(`\ncompared with ${args.compare}\n${rendered}`);
    writeFileSync(join(runDir, "comparison.txt"), `${rendered}\n`);
  }
  if (args.markdown) appendFileSync(args.markdown, `${renderMarkdown(result, comparison)}\n`);

  const failed = Object.values(scenarios).some((s) => s.error !== undefined);
  if (failed) log("some scenarios failed");
  if (comparison && comparison.regressions.length > 0) return 1;
  return failed ? 1 : 0;
};

process.exit(await main());

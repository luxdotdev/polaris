#!/usr/bin/env bun
/**
 * Runs every check of the Quint spec (what CI's `spec` job runs).
 *
 *   bun run spec                      typecheck, scenario tests, simulator
 *   bun run spec -- --samples 20000   a longer simulation
 *   bun run spec -- --verify          also Apalache (`quint verify`, needs Java 17+)
 *   bun run spec -- --verify --steps 5
 *
 * The simulator runs with a fixed seed, so a run is reproducible and the
 * witness counts below are stable; change `--seed` to explore elsewhere.
 */
import { join } from "node:path"

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? fallback : (args[at + 1] ?? fallback)
}
const samples = option("samples", "3000")
const steps = option("steps", "4")
const seed = option("seed", "0x5eed")
const verify = args.includes("--verify")

const dir = join(import.meta.dir, "..")
const quint = join(dir, "node_modules", ".bin", "quint")

/** States the simulation must reach, or its checks prove little (see polaris.qnt). */
const WITNESSES = [
  "witnessDropped",
  "witnessResumedAfterDrop",
  "witnessDuplicateAnswered",
  "witnessRetryAfterCrash",
  "witnessAnswerRace",
  "witnessHarnessWithdrew",
  "witnessRestartWithdrew",
  "witnessContinued",
  "witnessBatchOfTwo",
]

let failed = false

const run = (label: string, argv: ReadonlyArray<string>, expectFailure = false) => {
  const started = performance.now()
  const result = Bun.spawnSync([quint, ...argv], { cwd: dir, stdout: "pipe", stderr: "pipe" })
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  const output = `${result.stdout}${result.stderr}`
  const ok = expectFailure ? result.exitCode !== 0 : result.exitCode === 0
  console.log(`${ok ? "✓" : "✗"} ${label} (${seconds}s)`)
  const summary = output
    .split("\n")
    .filter((line) => /^\[(ok|violation)\]|witnessed in|passing|failing|failed/.test(line.trim()))
  for (const line of summary) console.log(`    ${line.trim()}`)
  if (!ok) {
    failed = true
    if (expectFailure) {
      console.log("    expected a violation (a known finding) but found none: was it fixed?")
    } else {
      console.log(output)
    }
  }
  return output
}

run("typecheck polaris.qnt", ["typecheck", "polaris.qnt"])
run("typecheck polaris_test.qnt", ["typecheck", "polaris_test.qnt"])
run("scenario tests (fixed host feed)", ["test", "polaris_test.qnt", "--main=polaris_test"])
run("scenario tests (current host feed)", [
  "test",
  "polaris_test.qnt",
  "--main=polaris_current_test",
])

const simulate = (main: string, invariants: ReadonlyArray<string>, witnesses = false) => [
  "run",
  "polaris.qnt",
  `--main=${main}`,
  "--invariants",
  ...invariants,
  `--max-samples=${samples}`,
  "--max-steps=60",
  `--seed=${seed}`,
  "--verbosity=1",
  ...(witnesses ? ["--witnesses", ...WITNESSES] : []),
]

const simulated = run(
  `simulate current: safety, ${samples} traces of up to 60 steps`,
  simulate("current", ["safety"], true),
)
for (const witness of WITNESSES) {
  if (new RegExp(`${witness} was witnessed in 0 trace`).test(simulated)) {
    failed = true
    console.log(`✗ ${witness} was never reached: the simulation no longer covers it`)
  }
}
run(
  `simulate fixed: safety and hostFeedCanProgress, ${samples} traces`,
  simulate("fixed", ["safety", "hostFeedCanProgress"]),
)
run(
  "simulate current: hostFeedCanProgress is violated (known finding 1)",
  simulate("current", ["hostFeedCanProgress"]),
  true,
)

if (verify) {
  run(`verify small with Apalache: safety, up to ${steps} steps`, [
    "verify",
    "polaris.qnt",
    "--main=small",
    "--invariant=safety",
    `--max-steps=${steps}`,
    "--verbosity=1",
  ])
}

process.exit(failed ? 1 : 0)

/**
 * The file-level quality checks behind the git hooks: Biome formatting, then the
 * oxlint ratchet. Same rules as `bun run lint` in CI, scoped to the given files.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { ROOT } from "../lint/oxlint.ts"

export { ROOT }

export type Mode = "fix" | "check"

export interface Step {
  readonly label: string
  readonly command: ReadonlyArray<string>
}

export interface Failure {
  readonly step: Step
  readonly output: string
}

const bin = (name: string) => join(ROOT, "node_modules/.bin", name)

/** Whether this checkout has its dependencies installed; hooks refuse to run without them. */
export const installed = () => existsSync(bin("biome")) && existsSync(bin("oxlint"))

/** Biome formats (or checks) the files, then the ratchet lints them. Deleted files are skipped. */
export const planChecks = (files: ReadonlyArray<string>, mode: Mode): ReadonlyArray<Step> => {
  const present = [...new Set(files)].filter((f) => existsSync(join(ROOT, f)))

  if (present.length === 0) return []

  const write = mode === "fix" ? ["--write"] : []

  return [
    {
      label: mode === "fix" ? "biome format" : "biome check",
      command: [
        bin("biome"),
        "check",
        ...write,
        "--no-errors-on-unmatched",
        "--files-ignore-unknown=true",
        ...present,
      ],
    },
    {
      label: "oxlint ratchet",
      command: [process.execPath, join(ROOT, "tooling/lint/ratchet.ts"), ...present],
    },
  ]
}

const runStep = async (step: Step): Promise<Failure | null> => {
  const child = Bun.spawn([...step.command], {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  return code === 0 ? null : { step, output: `${stdout}${stderr}`.trim() }
}

/** Runs the steps in order and stops at the first failure. */
export const runSteps = async (steps: ReadonlyArray<Step>): Promise<Failure | null> => {
  for (const step of steps) {
    const failure = await runStep(step)

    if (failure !== null) return failure
  }

  return null
}

export const formatFailure = ({ step, output }: Failure) => `✖ ${step.label}\n${output}`

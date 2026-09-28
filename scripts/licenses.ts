#!/usr/bin/env bun
/**
 * Licence gate and third-party notices.
 *
 *   bun scripts/licenses.ts           regenerate THIRD_PARTY_NOTICES.md
 *   bun scripts/licenses.ts --check   fail on a disallowed licence or stale notices
 *
 * Walks the installed production dependency tree (`dependencies` and
 * `optionalDependencies`, transitively) of every workspace package (apps/*,
 * packages/*), reads each package's declared licence, and enforces the
 * allowlist below. Anything else, including an unknown or missing licence,
 * fails unless `scripts/license-exceptions.json` lists the package with a
 * reason. Notices include each package's licence text and any upstream
 * NOTICE file verbatim (Apache-2.0 §4d).
 */
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export const ALLOWED = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "OFL-1.1",
  "MPL-2.0",
])

const root = join(import.meta.dir, "..")
const noticesPath = join(root, "THIRD_PARTY_NOTICES.md")
const exceptionsPath = join(import.meta.dir, "license-exceptions.json")

interface PackageJson {
  readonly name?: string
  readonly version?: string
  readonly private?: boolean
  readonly license?: string | { readonly type?: string }
  readonly licenses?: ReadonlyArray<{ readonly type?: string }>
  readonly repository?: string | { readonly url?: string }
  readonly homepage?: string
  readonly workspaces?: ReadonlyArray<string> | { readonly packages?: ReadonlyArray<string> }
  readonly dependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
}

export interface Dependency {
  readonly name: string
  readonly version: string
  readonly license: string | null
  readonly dir: string
  readonly repository: string | null
  /** Workspace packages that (transitively) pull this in. */
  readonly requiredBy: Set<string>
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T

/** The declared licence as an SPDX expression, or null if none is declared. */
export const declaredLicense = (pkg: PackageJson): string | null => {
  if (typeof pkg.license === "string") return pkg.license
  if (pkg.license?.type) return pkg.license.type
  const legacy = pkg.licenses?.flatMap((entry) => (entry.type ? [entry.type] : [])) ?? []
  if (legacy.length === 1) return legacy[0]!
  if (legacy.length > 1) return `(${legacy.join(" OR ")})`
  return null
}

/**
 * Whether an SPDX expression is satisfied by the allowlist: `A OR B` needs
 * one side, `A AND B` needs both, `A WITH exception` is judged by `A`.
 * Anything unparseable (e.g. `SEE LICENSE IN …`) is not allowed.
 */
export const isAllowed = (expression: string, allowed: ReadonlySet<string> = ALLOWED): boolean => {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? []
  let position = 0
  const peek = () => tokens[position]
  const orExpr = (): boolean => {
    let value = andExpr()
    while (peek()?.toUpperCase() === "OR") {
      position++
      const right = andExpr()
      value = value || right
    }
    return value
  }
  const andExpr = (): boolean => {
    let value = atom()
    while (peek()?.toUpperCase() === "AND") {
      position++
      const right = atom()
      value = value && right
    }
    return value
  }
  const atom = (): boolean => {
    const token = tokens[position++]
    if (token === undefined) throw new Error("unexpected end")
    if (token === "(") {
      const value = orExpr()
      if (tokens[position++] !== ")") throw new Error("expected )")
      return value
    }
    if (peek()?.toUpperCase() === "WITH") position += 2
    return allowed.has(token.replace(/\+$/, ""))
  }
  try {
    const value = orExpr()
    return position === tokens.length && value
  } catch {
    return false
  }
}

const workspaceDirs = (): ReadonlyArray<string> => {
  const pkg = readJson<PackageJson>(join(root, "package.json"))
  const patterns = Array.isArray(pkg.workspaces)
    ? pkg.workspaces
    : ((pkg.workspaces as { packages?: ReadonlyArray<string> } | undefined)?.packages ?? [])
  return patterns.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [join(root, pattern)]
    const parent = join(root, pattern.slice(0, -2))
    if (!existsSync(parent)) return []
    return readdirSync(parent)
      .map((name) => join(parent, name))
      .filter((dir) => existsSync(join(dir, "package.json")))
  })
}

/** Node's lookup: `<dir>/node_modules/<name>`, walking up from the requiring package's real path. */
const resolvePackageDir = (fromDir: string, name: string): string | null => {
  let dir = realpathSync(fromDir)
  for (;;) {
    const candidate = join(dir, "node_modules", name)
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate)
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const repositoryUrl = (pkg: PackageJson): string | null => {
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url
  const url = repo ?? pkg.homepage ?? null
  return url?.replace(/^git\+/, "").replace(/\.git$/, "") ?? null
}

export const collect = (): { deps: Map<string, Dependency>; missing: Array<string> } => {
  const deps = new Map<string, Dependency>()
  const missing: Array<string> = []
  const workspaces = workspaceDirs().map((dir) => ({
    dir,
    pkg: readJson<PackageJson>(join(dir, "package.json")),
  }))
  const workspaceNames = new Set(workspaces.map((w) => w.pkg.name))

  const visit = (fromDir: string, pkg: PackageJson, workspace: string, seen: Set<string>) => {
    const required = Object.keys(pkg.dependencies ?? {})
    const optional = Object.keys(pkg.optionalDependencies ?? {})
    for (const name of [...required, ...optional]) {
      if (workspaceNames.has(name)) continue // visited as a workspace in its own right
      const dir = resolvePackageDir(fromDir, name)
      if (dir === null) {
        // Optional platform packages for other OSes are legitimately absent.
        if (!optional.includes(name)) missing.push(`${name} (required by ${pkg.name})`)
        continue
      }
      const child = readJson<PackageJson>(join(dir, "package.json"))
      const key = `${child.name}@${child.version}`
      const existing = deps.get(key)
      if (existing) {
        existing.requiredBy.add(workspace)
        if (seen.has(key)) continue
      } else {
        deps.set(key, {
          name: child.name ?? name,
          version: child.version ?? "0.0.0",
          license: declaredLicense(child),
          dir,
          repository: repositoryUrl(child),
          requiredBy: new Set([workspace]),
        })
      }
      seen.add(key)
      visit(dir, child, workspace, seen)
    }
  }

  for (const { dir, pkg } of workspaces) visit(dir, pkg, pkg.name ?? dir, new Set())
  return { deps, missing }
}

interface Exceptions {
  readonly exceptions: Record<string, { readonly reason: string }>
}

const readExceptions = (): Exceptions["exceptions"] =>
  existsSync(exceptionsPath) ? readJson<Exceptions>(exceptionsPath).exceptions : {}

export interface Verdict {
  readonly dep: Dependency
  readonly status: "allowed" | "exception" | "violation"
  readonly reason: string | null
}

export const judge = (
  deps: Iterable<Dependency>,
  exceptions: Exceptions["exceptions"],
): Array<Verdict> =>
  [...deps].map((dep) => {
    if (dep.license !== null && isAllowed(dep.license)) {
      return { dep, status: "allowed", reason: null } as const
    }
    const exception = exceptions[dep.name]
    if (exception) return { dep, status: "exception", reason: exception.reason } as const
    return { dep, status: "violation", reason: null } as const
  })

const LICENSE_FILE = /^(licen[cs]e|copying)(\.|-|$)/i
const NOTICE_FILE = /^notice(\.|$)/i

const filesMatching = (dir: string, pattern: RegExp): Array<string> =>
  readdirSync(dir)
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => readFileSync(join(dir, name), "utf8").trim())

const byName = (a: Verdict, b: Verdict) =>
  a.dep.name.localeCompare(b.dep.name) || a.dep.version.localeCompare(b.dep.version)

export const renderNotices = (verdicts: ReadonlyArray<Verdict>): string => {
  const sorted = [...verdicts].sort(byName)
  const lines: Array<string> = [
    "# Third-party notices",
    "",
    "Generated by `bun run licenses` from the installed production dependencies of the Polaris workspace packages. Do not edit by hand.",
    "",
    "| Package | Version | Licence | Source |",
    "|---|---|---|---|",
    ...sorted.map(
      ({ dep, status }) =>
        `| ${dep.name} | ${dep.version} | ${dep.license ?? "unknown"}${status === "exception" ? " (exception)" : ""} | ${dep.repository ?? ""} |`,
    ),
    "",
  ]
  const exceptions = sorted.filter((v) => v.status === "exception")
  if (exceptions.length > 0) {
    lines.push("## Licence exceptions", "")
    for (const { dep, reason } of exceptions) lines.push(`- **${dep.name}**: ${reason}`)
    lines.push("")
  }
  lines.push("## Licence texts", "")
  for (const { dep } of sorted) {
    lines.push(`### ${dep.name}@${dep.version}`, "")
    const texts = filesMatching(dep.dir, LICENSE_FILE)
    if (texts.length === 0)
      lines.push(`Licensed under ${dep.license ?? "unknown terms"} (no licence file shipped).`, "")
    for (const text of texts) lines.push("```text", text, "```", "")
    for (const notice of filesMatching(dep.dir, NOTICE_FILE)) {
      lines.push("NOTICE:", "", "```text", notice, "```", "")
    }
  }
  return `${lines.join("\n").trimEnd()}\n`
}

const main = () => {
  const check = process.argv.includes("--check")
  const { deps, missing } = collect()
  const verdicts = judge(deps.values(), readExceptions())
  const violations = verdicts.filter((v) => v.status === "violation")
  let failed = false

  if (missing.length > 0) {
    console.error(`Not installed (run bun install):\n  ${missing.join("\n  ")}`)
    failed = true
  }
  if (violations.length > 0) {
    console.error(
      `Licences outside the allowlist (${[...ALLOWED].join(", ")}):\n${violations
        .map(
          ({ dep }) =>
            `  ${dep.name}@${dep.version}: ${dep.license ?? "no licence declared"} (via ${[...dep.requiredBy].join(", ")})`,
        )
        .join(
          "\n",
        )}\nReplace the dependency or add it to scripts/license-exceptions.json with a reason.`,
    )
    failed = true
  }

  const notices = renderNotices(verdicts)
  if (check) {
    const current = existsSync(noticesPath) ? readFileSync(noticesPath, "utf8") : ""
    if (current !== notices) {
      console.error("THIRD_PARTY_NOTICES.md is out of date: run `bun run licenses`.")
      failed = true
    }
  } else if (violations.length === 0) {
    writeFileSync(noticesPath, notices)
    console.log(`Wrote ${noticesPath}`)
  }

  const exceptionCount = verdicts.filter((v) => v.status === "exception").length
  console.log(
    `${verdicts.length} production dependencies: ${verdicts.length - violations.length - exceptionCount} allowed, ${exceptionCount} by exception, ${violations.length} violations.`,
  )
  process.exit(failed ? 1 : 0)
}

if (import.meta.main) main()

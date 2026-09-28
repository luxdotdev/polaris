/**
 * The fff backend (`@ff-labs/fff-bun`, MIT, dmtrKovalenko/fff): typo-tolerant
 * path search with frecency, content grep, and a background watcher, from a
 * native library loaded through `bun:ffi`.
 *
 * Loading: under `bun run` the library comes from the platform package
 * (`@ff-labs/fff-bin-<platform>`). `bun build --compile` embeds it into the
 * binary (Linux builds need `--define FFF_LIBC='"gnu"'` or `'"musl"'`). If it
 * can't load, or `POLARIS_FFF=off`, callers fall back to `fallback.ts`.
 */
import { createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import type { FileFinder as FileFinderType } from "@ff-labs/fff-bun"
import { paths } from "../../paths.ts"
import type { FileChange, SearchBackend } from "./types.ts"

type FileFinderClass = typeof FileFinderType

/** How long the first search waits for the initial scan before answering from a partial index. */
const SCAN_WAIT_MS = 5_000

let loaded: Promise<FileFinderClass | null> | undefined
let loadError: string | null = null

export const fffDisabled = (): boolean => {
  const flag = process.env.POLARIS_FFF?.toLowerCase()
  return flag === "off" || flag === "0" || flag === "false"
}

/** Imports fff once. Resolves to null (and records why) when it can't load. */
export const loadFff = (): Promise<FileFinderClass | null> => {
  if (fffDisabled()) {
    loadError = "disabled by POLARIS_FFF"
    return Promise.resolve(null)
  }
  loaded ??= import("@ff-labs/fff-bun")
    .then((module) => module.FileFinder)
    .catch((cause: unknown) => {
      loadError = cause instanceof Error ? cause.message : String(cause)
      return null
    })
  return loaded
}

/** Why fff isn't in use, if it isn't. */
export const fffLoadError = (): string | null => loadError

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const mapKind = (kind: string): FileChange["kind"] | null => {
  switch (kind) {
    case "created":
      return "created"
    case "modified":
      return "modified"
    case "removed":
      return "deleted"
    case "renamed":
      return "renamed"
    default:
      return null
  }
}

/**
 * Creates an fff index for `root`, or null when the native library can't load
 * or refuses the root. Frecency and query history live under
 * `~/.polaris/fff/<hash of root>/` (one LMDB environment per index).
 */
export const makeFffBackend = async (root: string): Promise<SearchBackend | null> => {
  const FileFinder = await loadFff()
  if (FileFinder === null) return null
  const dbDir = join(
    paths().root,
    "fff",
    createHash("sha256").update(root).digest("hex").slice(0, 16),
  )
  let finder: FileFinderType
  try {
    mkdirSync(dbDir, { recursive: true })
    const created = FileFinder.create({
      basePath: root,
      frecencyDbPath: join(dbDir, "frecency.mdb"),
      historyDbPath: join(dbDir, "history.mdb"),
    })
    if (!created.ok) {
      loadError = created.error
      return null
    }
    finder = created.value
  } catch (cause) {
    // Thrown (not returned) when the native library itself fails to load.
    loadError = cause instanceof Error ? cause.message : String(cause)
    loaded = Promise.resolve(null)
    return null
  }

  let scanned: Promise<unknown> | undefined
  const ready = () => {
    scanned ??= finder.waitForScan(SCAN_WAIT_MS)
    return scanned
  }
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
    if (!result.ok) throw new Error(result.error)
    return result.value
  }
  const subscriptions = new Set<() => void>()

  return {
    kind: "fff",
    root,
    searchPaths: async (query, limit) => {
      await ready()
      const result = unwrap(finder.fileSearch(query, { pageSize: limit }))
      return result.items.map((item, i) => ({
        path: join(root, item.relativePath),
        score: result.scores[i]?.total ?? 0,
      }))
    },
    grep: async ({ pattern, regex, caseSensitive, limit }) => {
      await ready()
      // fff has no case-insensitive flag, only smart case; force insensitivity with `(?i)`.
      const options = caseSensitive
        ? { mode: regex ? ("regex" as const) : ("plain" as const), smartCase: false }
        : { mode: "regex" as const, smartCase: false }
      const query = caseSensitive ? pattern : `(?i)${regex ? pattern : escapeRegex(pattern)}`
      const result = unwrap(finder.grep(query, { ...options, pageSize: limit }))
      if (result.regexFallbackError !== undefined) throw new Error(result.regexFallbackError)
      return result.items.slice(0, limit).map((match) => ({
        path: join(root, match.relativePath),
        line: match.lineNumber,
        column: match.col + 1,
        text: match.lineContent,
      }))
    },
    watch: async (onBatch) => {
      // fff drops subscriptions made before its initial scan and watcher are ready.
      await ready()
      const deadline = Date.now() + SCAN_WAIT_MS
      while (!(unwrap(finder.getScanProgress()).isWatcherReady || Date.now() > deadline)) {
        await Bun.sleep(20)
      }
      const subscription = finder.watch((events) => {
        const changes: Array<FileChange> = []
        for (const event of events) {
          const kind = mapKind(event.kind)
          // `rescan` means events were lost: report the root as modified so Clients re-read.
          changes.push(
            kind === null ? { path: root, kind: "modified" } : { path: event.path, kind },
          )
        }
        if (changes.length > 0) onBatch(changes)
      })
      if (!subscription.ok) throw new Error(subscription.error)
      const stop = () => {
        subscription.value()
        subscriptions.delete(stop)
      }
      subscriptions.add(stop)
      return stop
    },
    dispose: () => {
      for (const stop of [...subscriptions]) stop()
      finder.destroy()
    },
  }
}

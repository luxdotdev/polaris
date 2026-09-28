/**
 * Staged attachments: bytes a Client sends with a Turn, written on the Host so
 * the Harness can read them by path.
 *
 * Layout under `paths().staging` (`~/.polaris/staging`):
 *
 *   <session>/<attachment id>/<safe name>        the bytes (`hostPath`)
 *   <session>/<attachment id>/.meta.json         id, name, mime type, size, Workspace, time
 *   _pending/<workspace>/<attachment id>/…       staged before the Agent Session exists
 *
 * Cleanup policy (Settings; default "on-archive", overridable per Workspace):
 *   on-archive   delete a session's attachments when it is Archived
 *   after-days   delete attachments N days after they were staged (periodic sweeper)
 *   never        keep them until "clear now"
 * `_pending` attachments never see an archive, so under "on-archive" the
 * sweeper deletes them after `PENDING_MAX_AGE_DAYS`.
 */
import { randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Attachment, type AttachmentId, type SessionId, type WorkspaceId } from "@polaris/protocol"
import { Context, Effect, Layer } from "effect"
import { paths } from "../paths.ts"
import { AttachmentStore, ServiceError } from "../services.ts"

export type CleanupPolicy =
  | { readonly kind: "on-archive" }
  | { readonly kind: "after-days"; readonly days: number }
  | { readonly kind: "never" }

export interface AttachmentSettings {
  readonly default: CleanupPolicy
  /** Per-Workspace overrides of `default`. */
  readonly workspaces: Readonly<Record<string, CleanupPolicy>>
}

export const defaultAttachmentSettings: AttachmentSettings = {
  default: { kind: "on-archive" },
  workspaces: {},
}

/** Unsessioned attachments older than this are swept under the "on-archive" policy. */
export const PENDING_MAX_AGE_DAYS = 7
const PENDING_DIR = "_pending"
const META_FILE = ".meta.json"
const DAY_MS = 24 * 60 * 60 * 1000

export interface AttachmentUsage {
  /** Bytes of staged attachments on this Host. */
  readonly bytes: number
  readonly files: number
}

/** Settings-page operations on the store. Implemented alongside `AttachmentStore`. */
export class AttachmentMaintenance extends Context.Service<
  AttachmentMaintenance,
  {
    readonly settings: Effect.Effect<AttachmentSettings>
    readonly setSettings: (settings: AttachmentSettings) => Effect.Effect<void, ServiceError>
    readonly usage: Effect.Effect<AttachmentUsage, ServiceError>
    /** Deletes staged attachments now: all of them, or one Workspace's. */
    readonly clearNow: (options?: {
      readonly workspaceId?: WorkspaceId
    }) => Effect.Effect<AttachmentUsage, ServiceError>
    /** Applies the "after-days" (and pending) policy now; the periodic sweeper calls this. */
    readonly sweep: Effect.Effect<number, ServiceError>
  }
>()("polaris/daemon/attachments/AttachmentMaintenance") {}

interface Meta {
  readonly id: string
  readonly name: string
  readonly mimeType: string
  readonly size: number
  readonly hostPath: string
  readonly sessionId: string | null
  readonly workspaceId: string
  /** Epoch milliseconds. */
  readonly stagedAt: number
}

/**
 * A file name that is safe on every Host: no directories, no control or
 * reserved characters, no leading dots, at most 120 characters (keeping the
 * extension).
 */
export const safeFileName = (name: string): string => {
  const base = name.split(/[/\\]/).pop() ?? ""
  let safe = Array.from(base, (c) => {
    const code = c.charCodeAt(0)
    return code < 0x20 || code === 0x7f || ':*?"<>|'.includes(c) ? "_" : c
  })
    .join("")
    .replace(/^[.\s]+/, "")
    .trim()
  if (safe.length > 120) {
    const dot = safe.lastIndexOf(".")
    const ext = dot > 0 && safe.length - dot <= 16 ? safe.slice(dot) : ""
    safe = safe.slice(0, 120 - ext.length) + ext
  }
  return safe === "" ? "attachment" : safe
}

/** A single path segment derived from an id (ids are opaque strings). */
const segment = (id: string): string => {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_")
  return safe === "" ? "_" : safe
}

const toServiceError = (message: string) => (cause: unknown) =>
  new ServiceError({
    service: "AttachmentStore",
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  })

const toAttachment = (meta: Meta) =>
  new Attachment({
    id: meta.id as AttachmentId,
    name: meta.name,
    mimeType: meta.mimeType,
    size: meta.size,
    hostPath: meta.hostPath,
  })

const isEnoent = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT"

const listDirs = async (dir: string): Promise<Array<string>> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name))
  } catch (cause) {
    if (isEnoent(cause)) return []
    throw cause
  }
}

export interface AttachmentStoreOptions {
  /** Staging root; defaults to `paths().staging`. */
  readonly root?: string
  /** Where settings persist; defaults to `~/.polaris/attachment-settings.json`. */
  readonly settingsPath?: string
  /** How often the sweeper runs (default hourly). */
  readonly sweepMs?: number
  /** Clock, for tests. */
  readonly now?: () => number
}

export const makeAttachmentStore = (options: AttachmentStoreOptions = {}) =>
  Effect.gen(function* () {
    const root = options.root ?? paths().staging
    const settingsPath = options.settingsPath ?? join(paths().root, "attachment-settings.json")
    const now = options.now ?? Date.now

    let settings: AttachmentSettings = yield* Effect.promise(async () => {
      try {
        const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as AttachmentSettings
        return { ...defaultAttachmentSettings, ...parsed }
      } catch {
        return defaultAttachmentSettings
      }
    })
    const policyFor = (workspaceId: string): CleanupPolicy =>
      settings.workspaces[workspaceId] ?? settings.default

    /** Directory of every staged attachment (`…/<attachment id>`), by owner directory. */
    const attachmentDirs = async (): Promise<Array<string>> => {
      const owners = await listDirs(root)
      const dirs: Array<string> = []
      for (const owner of owners) {
        if (owner === join(root, PENDING_DIR)) {
          for (const workspace of await listDirs(owner)) dirs.push(...(await listDirs(workspace)))
        } else {
          dirs.push(...(await listDirs(owner)))
        }
      }
      return dirs
    }

    const readMeta = async (dir: string): Promise<Meta | null> => {
      try {
        return JSON.parse(await readFile(join(dir, META_FILE), "utf8")) as Meta
      } catch {
        return null
      }
    }

    const allMetas = async () => {
      const out: Array<{ dir: string; meta: Meta }> = []
      for (const dir of await attachmentDirs()) {
        const meta = await readMeta(dir)
        if (meta !== null) out.push({ dir, meta })
      }
      return out
    }

    /** Removes an attachment directory and its owner directories once empty. */
    const removeAttachmentDir = async (dir: string) => {
      await rm(dir, { recursive: true, force: true })
      let parent = join(dir, "..")
      while (parent.startsWith(root) && parent !== root) {
        if ((await readdir(parent).catch(() => ["x"])).length > 0) break
        await rm(parent, { recursive: true, force: true })
        parent = join(parent, "..")
      }
    }

    const stage = Effect.fn("AttachmentStore.stage")(function* (input: {
      readonly sessionId: SessionId | null
      readonly workspaceId: WorkspaceId
      readonly name: string
      readonly mimeType: string
      readonly bytes: Uint8Array
    }) {
      const id = randomUUID()
      const owner =
        input.sessionId === null
          ? join(root, PENDING_DIR, segment(input.workspaceId))
          : join(root, segment(input.sessionId))
      const dir = join(owner, id)
      const hostPath = join(dir, safeFileName(input.name))
      const meta: Meta = {
        id,
        name: input.name,
        mimeType: input.mimeType,
        size: input.bytes.byteLength,
        hostPath,
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        stagedAt: now(),
      }
      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(dir, { recursive: true, mode: 0o700 })
          await writeFile(hostPath, input.bytes, { mode: 0o600 })
          await writeFile(join(dir, META_FILE), JSON.stringify(meta))
        },
        catch: toServiceError(`staging ${input.name}`),
      })
      return toAttachment(meta)
    })

    const get = Effect.fn("AttachmentStore.get")(function* (ids: ReadonlyArray<AttachmentId>) {
      const wanted = new Set<string>(ids)
      const metas = yield* Effect.tryPromise({
        try: allMetas,
        catch: toServiceError("listing attachments"),
      })
      const byId = new Map(metas.map(({ meta }) => [meta.id, meta]))
      // Missing (already cleaned up) attachments are left out, in request order otherwise.
      return ids.flatMap((id) => {
        const meta = wanted.has(id) ? byId.get(id) : undefined
        return meta === undefined ? [] : [toAttachment(meta)]
      })
    })

    const onSessionArchived = Effect.fn("AttachmentStore.onSessionArchived")(function* (
      sessionId: SessionId,
    ) {
      yield* Effect.tryPromise({
        try: async () => {
          const owner = join(root, segment(sessionId))
          for (const dir of await listDirs(owner)) {
            const meta = await readMeta(dir)
            if (meta === null || policyFor(meta.workspaceId).kind === "on-archive") {
              await removeAttachmentDir(dir)
            }
          }
        },
        catch: toServiceError(`cleaning up session ${sessionId}`),
      })
    })

    const sweep = Effect.tryPromise({
      try: async () => {
        let removed = 0
        for (const { dir, meta } of await allMetas()) {
          const policy = policyFor(meta.workspaceId)
          const ageDays = (now() - meta.stagedAt) / DAY_MS
          const expired =
            policy.kind === "after-days"
              ? ageDays >= policy.days
              : policy.kind === "on-archive" && meta.sessionId === null
                ? ageDays >= PENDING_MAX_AGE_DAYS
                : false
          if (expired) {
            await removeAttachmentDir(dir)
            removed++
          }
        }
        return removed
      },
      catch: toServiceError("sweeping attachments"),
    })

    const usageOf = async (dirs: ReadonlyArray<string>): Promise<AttachmentUsage> => {
      let bytes = 0
      let files = 0
      for (const dir of dirs) {
        const meta = await readMeta(dir)
        if (meta === null) continue
        const size = await stat(meta.hostPath).then(
          (s) => s.size,
          () => null,
        )
        if (size === null) continue
        bytes += size
        files++
      }
      return { bytes, files }
    }

    const maintenance = AttachmentMaintenance.of({
      settings: Effect.sync(() => settings),
      setSettings: (next) =>
        Effect.tryPromise({
          try: async () => {
            await mkdir(join(settingsPath, ".."), { recursive: true })
            await writeFile(settingsPath, JSON.stringify(next, null, 2))
            settings = next
          },
          catch: toServiceError("saving attachment settings"),
        }),
      usage: Effect.tryPromise({
        try: async () => usageOf(await attachmentDirs()),
        catch: toServiceError("measuring attachments"),
      }),
      clearNow: (clear = {}) =>
        Effect.tryPromise({
          try: async () => {
            const targets =
              clear.workspaceId === undefined
                ? await attachmentDirs()
                : (await allMetas())
                    .filter(({ meta }) => meta.workspaceId === clear.workspaceId)
                    .map(({ dir }) => dir)
            const cleared = await usageOf(targets)
            for (const dir of targets) await removeAttachmentDir(dir)
            return cleared
          },
          catch: toServiceError("clearing attachments"),
        }),
      sweep,
    })

    const sweepMs = options.sweepMs ?? 60 * 60 * 1000
    const timer = setInterval(() => {
      void Effect.runPromise(Effect.ignore(sweep))
    }, sweepMs)
    yield* Effect.addFinalizer(() => Effect.sync(() => clearInterval(timer)))

    return {
      store: AttachmentStore.of({ stage, get, onSessionArchived }),
      maintenance,
    }
  })

/** Provides `AttachmentStore` and `AttachmentMaintenance`, and runs the periodic sweeper. */
export const AttachmentStoreLive = (options: AttachmentStoreOptions = {}) =>
  Layer.effectContext(
    Effect.map(makeAttachmentStore(options), ({ store, maintenance }) =>
      Context.make(AttachmentStore, store).pipe(Context.add(AttachmentMaintenance, maintenance)),
    ),
  )

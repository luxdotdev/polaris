/**
 * The fff backend (`@ff-labs/fff-bun`, MIT, dmtrKovalenko/fff): typo-tolerant
 * path search with frecency, content grep, and a background watcher, from a
 * native library loaded through `bun:ffi`.
 *
 * fff's calls are synchronous, and a grep that reads the whole tree takes
 * most of a second on a large one, so the indexes live in a Bun Worker
 * (`fffWorker.ts`), one shared by every root: this module is its client. The
 * worker starts with the first index and stops when the last one is dropped,
 * so an idle Daemon without indexes has no worker.
 *
 * Loading: under `bun run` the library comes from the platform package
 * (`@ff-labs/fff-bin-<platform>`). `bun build --compile` embeds it into the
 * binary (Linux builds need `--define FFF_LIBC='"gnu"'` or `'"musl"'`), with
 * the worker as a second entrypoint. If it can't load, or `POLARIS_FFF=off`,
 * callers fall back to `fallback.ts`.
 */
import { createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { paths } from "../../paths.ts"
import type { WorkerReply, WorkerRequest, WorkerWatchEvent } from "./fffWorker.ts"
import type { FileChange, GrepHit, PathHit, SearchBackend } from "./types.ts"

let loadError: string | null = null
/** Set once fff failed to load in the worker: later indexes go straight to the fallback. */
let unavailable = false

export const fffDisabled = (): boolean => {
  const flag = process.env.POLARIS_FFF?.toLowerCase()
  return flag === "off" || flag === "0" || flag === "false"
}

/** Why fff isn't in use, if it isn't. */
export const fffLoadError = (): string | null => loadError

type Distribute<T> = T extends unknown ? Omit<T, "id"> : never
type Request = Distribute<WorkerRequest>

class FffUnavailable extends Error {
  constructor(
    readonly reason: "library" | "root",
    message: string,
  ) {
    super(message)
  }
}

interface Connection {
  readonly worker: Worker
  readonly pending: Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >
  readonly watchers: Map<number, (changes: ReadonlyArray<FileChange>) => void>
  nextId: number
  /** Open indexes; the worker stops when this drops to zero. */
  open: number
}

let connection: Connection | null = null
let nextIndex = 1
let nextSubscription = 1

/**
 * The worker's entrypoint. From source it sits next to this file. In the
 * compiled binary this module is bundled into `/$bunfs/root/polaris`, and the
 * worker entrypoint is `/$bunfs/root/<its path relative to the entrypoints'
 * common directory, apps/daemon/src>.js`.
 */
const workerUrl = (): string => {
  const beside = new URL("./fffWorker.ts", import.meta.url)
  return beside.pathname.startsWith("/$bunfs/")
    ? new URL("./files/search/fffWorker.js", import.meta.url).href
    : beside.href
}

const connect = (): Connection => {
  if (connection !== null) return connection
  const worker = new Worker(workerUrl())
  // The Daemon's own lifetime decides; an open index must not keep it alive.
  worker.unref()
  const conn: Connection = { worker, pending: new Map(), watchers: new Map(), nextId: 1, open: 0 }
  worker.onmessage = (message: MessageEvent<WorkerReply | WorkerWatchEvent>) => {
    const data = message.data
    if ("subscription" in data) {
      conn.watchers.get(data.subscription)?.(data.changes)
      return
    }
    const waiter = conn.pending.get(data.id)
    if (waiter === undefined) return
    conn.pending.delete(data.id)
    if (data.ok) waiter.resolve(data.value)
    else if (data.unavailable !== undefined)
      waiter.reject(new FffUnavailable(data.unavailable, data.error))
    else waiter.reject(new Error(data.error))
  }
  worker.onerror = (event) => {
    // The worker died: fail what was in flight; the next index starts a new one.
    const error = new Error(`fff worker failed: ${event.message}`)
    for (const waiter of conn.pending.values()) waiter.reject(error)
    conn.pending.clear()
    if (connection === conn) connection = null
    conn.worker.terminate()
  }
  connection = conn
  return conn
}

const call = <A>(conn: Connection, request: Request): Promise<A> =>
  new Promise<A>((resolve, reject) => {
    const id = conn.nextId++
    conn.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    conn.worker.postMessage({ ...request, id } as WorkerRequest)
  })

/** Drops one open index; the last one stops the worker once the worker has closed it. */
const release = (conn: Connection, index: number) => {
  conn.open--
  void call(conn, { op: "close", index })
    .catch(() => {})
    .then(() => {
      if (conn.open === 0 && conn.pending.size === 0 && connection === conn) {
        connection = null
        conn.worker.terminate()
      }
    })
}

/**
 * Whether fff can be used at all: false when `POLARIS_FFF=off` or after its
 * library failed to load. (Loading itself is only tried by the first index.)
 */
export const loadFff = async (): Promise<true | null> => {
  if (fffDisabled()) {
    loadError = "disabled by POLARIS_FFF"
    return null
  }
  return unavailable ? null : true
}

/**
 * Creates an fff index for `root` in the worker, or null when the native
 * library can't load or refuses the root. Frecency and query history live
 * under `~/.polaris/fff/<hash of root>/` (one LMDB environment per index).
 */
export const makeFffBackend = async (root: string): Promise<SearchBackend | null> => {
  if ((await loadFff()) === null) return null
  const dbDir = join(
    paths().root,
    "fff",
    createHash("sha256").update(root).digest("hex").slice(0, 16),
  )
  mkdirSync(dbDir, { recursive: true })
  const conn = connect()
  const index = nextIndex++
  conn.open++
  try {
    await call(conn, {
      op: "open",
      index,
      root,
      frecencyDbPath: join(dbDir, "frecency.mdb"),
      historyDbPath: join(dbDir, "history.mdb"),
    })
  } catch (cause) {
    release(conn, index)
    loadError = cause instanceof Error ? cause.message : String(cause)
    if (cause instanceof FffUnavailable) {
      if (cause.reason === "library") unavailable = true
      return null
    }
    throw cause
  }
  loadError = null

  const subscriptions = new Set<number>()
  let disposed = false
  return {
    kind: "fff",
    root,
    searchPaths: (query, limit) =>
      call<ReadonlyArray<PathHit>>(conn, { op: "searchPaths", index, query, limit }),
    grep: (query) => call<ReadonlyArray<GrepHit>>(conn, { op: "grep", index, query }),
    watch: async (onBatch) => {
      const subscription = nextSubscription++
      conn.watchers.set(subscription, onBatch)
      subscriptions.add(subscription)
      const stop = () => {
        if (!subscriptions.delete(subscription)) return
        conn.watchers.delete(subscription)
        if (!disposed) void call(conn, { op: "unwatch", index, subscription }).catch(() => {})
      }
      try {
        await call(conn, { op: "watch", index, subscription })
      } catch (cause) {
        stop()
        throw cause
      }
      return stop
    },
    dispose: () => {
      if (disposed) return
      for (const subscription of subscriptions) conn.watchers.delete(subscription)
      subscriptions.clear()
      disposed = true
      release(conn, index)
    },
  }
}

/** Whether the fff worker is running (tests and diagnostics). */
export const fffWorkerRunning = (): boolean => connection !== null

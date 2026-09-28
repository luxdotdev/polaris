/**
 * Terminals on the Host, through `Bun.Terminal` (never node-pty). A terminal
 * belongs to the Daemon, not to a Client: it outlives Client disconnects, any
 * number of Clients can attach at once, and a late attacher first gets the
 * recent scrollback replayed.
 */
import { randomUUID } from "node:crypto"
import { stat } from "node:fs/promises"
import { userInfo } from "node:os"
import { FileError, NotFound, type TerminalId } from "@polaris/protocol"
import { Context, Effect, Layer, Queue, Stream } from "effect"
import { resolveHostPath, toFsFailure } from "../files/fs.ts"

/** Scrollback kept per terminal for replay to late attachers. */
export const SCROLLBACK_BYTES = 256 * 1024
/** After the process exits, how long to wait for the PTY to drain before reporting Exit. */
const DRAIN_AFTER_EXIT_MS = 200

export type TerminalItem =
  | { readonly _tag: "Output"; readonly data: Uint8Array }
  | { readonly _tag: "Exit"; readonly code: number | null }

/** A byte ring buffer of whole chunks, trimmed from the front to `capacity`. */
export class Scrollback {
  private chunks: Array<Uint8Array> = []
  private size = 0
  constructor(readonly capacity: number) {}

  push(chunk: Uint8Array): void {
    if (chunk.byteLength >= this.capacity) {
      this.chunks = [chunk.slice(chunk.byteLength - this.capacity)]
      this.size = this.capacity
      return
    }
    this.chunks.push(chunk)
    this.size += chunk.byteLength
    while (this.size > this.capacity) {
      const first = this.chunks[0]!
      const excess = this.size - this.capacity
      if (first.byteLength <= excess) {
        this.chunks.shift()
        this.size -= first.byteLength
      } else {
        this.chunks[0] = first.subarray(excess)
        this.size -= excess
      }
    }
  }

  snapshot(): Uint8Array {
    const out = new Uint8Array(this.size)
    let at = 0
    for (const chunk of this.chunks) {
      out.set(chunk, at)
      at += chunk.byteLength
    }
    return out
  }

  get byteLength(): number {
    return this.size
  }
}

export interface TerminalInfo {
  readonly id: TerminalId
  readonly cwd: string
  readonly argv: ReadonlyArray<string>
  readonly pid: number
  /** Null while running. */
  readonly exit: { readonly code: number | null } | null
}

interface Live {
  readonly info: Omit<TerminalInfo, "exit">
  readonly terminal: Bun.Terminal
  readonly process: Bun.Subprocess
  readonly scrollback: Scrollback
  readonly listeners: Set<(item: TerminalItem) => void>
  exit: { readonly code: number | null } | null
}

export class Terminals extends Context.Service<
  Terminals,
  {
    /** Starts the user's login shell (or `argv`) in `cwd`. */
    readonly open: (options: {
      readonly cwd: string
      readonly cols: number
      readonly rows: number
      readonly argv: ReadonlyArray<string> | null
    }) => Effect.Effect<TerminalId, FileError>
    /** Scrollback first, then live output; ends after `Exit`. */
    readonly attach: (id: TerminalId) => Stream.Stream<TerminalItem, NotFound>
    readonly input: (id: TerminalId, data: Uint8Array) => Effect.Effect<void, NotFound>
    readonly resize: (id: TerminalId, cols: number, rows: number) => Effect.Effect<void, NotFound>
    /** Hangs up the process (SIGHUP, as closing a terminal window does) and forgets the terminal. */
    readonly close: (id: TerminalId) => Effect.Effect<void, NotFound>
    readonly list: Effect.Effect<ReadonlyArray<TerminalInfo>>
  }
>()("polaris/daemon/terminal/Terminals") {}

/** The Host user's login shell: the passwd entry first (launchd/systemd may not set SHELL). */
export const loginShell = (): string => {
  try {
    const shell = userInfo().shell
    if (shell) return shell
  } catch {
    // No passwd entry (some containers).
  }
  return process.env.SHELL || "/bin/sh"
}

const clampSize = (n: number, fallback: number) =>
  Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 10_000) : fallback

export const makeTerminals = Effect.gen(function* () {
  const terminals = new Map<string, Live>()

  const notFound = (id: string) => new NotFound({ what: "terminal", id })
  const lookup = (id: TerminalId) =>
    Effect.suspend(() => {
      const live = terminals.get(id)
      return live === undefined ? Effect.fail(notFound(id)) : Effect.succeed(live)
    })

  const broadcast = (live: Live, item: TerminalItem) => {
    for (const listener of live.listeners) listener(item)
  }

  const finish = (live: Live, code: number | null) => {
    if (live.exit !== null) return
    live.exit = { code }
    broadcast(live, { _tag: "Exit", code })
    live.listeners.clear()
  }

  const kill = (live: Live) => {
    if (live.exit === null) {
      try {
        live.process.kill("SIGHUP")
      } catch {
        // Already gone.
      }
    }
    live.terminal.close()
  }

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const live of terminals.values()) kill(live)
      terminals.clear()
    }),
  )

  const open = Effect.fn("Terminals.open")(function* (options: {
    readonly cwd: string
    readonly cols: number
    readonly rows: number
    readonly argv: ReadonlyArray<string> | null
  }) {
    const cwd = resolveHostPath(options.cwd)
    yield* Effect.tryPromise({
      try: async () => {
        const stats = await stat(cwd)
        if (!stats.isDirectory()) {
          throw Object.assign(new Error(`not a directory: ${cwd}`), { code: "ENOTDIR" })
        }
      },
      catch: (cause) => {
        const failure = toFsFailure(cwd, cause)
        return new FileError({ path: cwd, code: failure.code, message: failure.message })
      },
    })
    const argv =
      options.argv !== null && options.argv.length > 0 ? [...options.argv] : [loginShell(), "-l"]
    const id = `term_${randomUUID()}` as TerminalId
    const scrollback = new Scrollback(SCROLLBACK_BYTES)
    const listeners = new Set<(item: TerminalItem) => void>()

    const spawned = yield* Effect.try({
      try: () => {
        const proc = Bun.spawn(argv, {
          cwd,
          env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
          terminal: {
            cols: clampSize(options.cols, 80),
            rows: clampSize(options.rows, 24),
            name: "xterm-256color",
            data: (_terminal, data) => {
              const chunk = new Uint8Array(data)
              scrollback.push(chunk)
              for (const listener of listeners) listener({ _tag: "Output", data: chunk })
            },
          },
        })
        return proc
      },
      catch: (cause) =>
        new FileError({
          path: argv[0] ?? cwd,
          code: toFsFailure(cwd, cause).code,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    })

    const live: Live = {
      info: { id, cwd, argv, pid: spawned.pid },
      terminal: spawned.terminal!,
      process: spawned,
      scrollback,
      listeners,
      exit: null,
    }
    terminals.set(id, live)
    void spawned.exited.then(() => {
      // Let the PTY drain the last output before reporting the exit.
      setTimeout(() => finish(live, spawned.exitCode), DRAIN_AFTER_EXIT_MS)
    })
    return id
  })

  const attach = (id: TerminalId): Stream.Stream<TerminalItem, NotFound> =>
    Stream.callback<TerminalItem, NotFound>((queue) =>
      Effect.gen(function* () {
        const live = yield* lookup(id)
        // Synchronous: no output can slip between the replay and the subscription.
        const replay = live.scrollback.snapshot()
        if (replay.byteLength > 0) Queue.offerUnsafe(queue, { _tag: "Output", data: replay })
        if (live.exit !== null) {
          Queue.offerUnsafe(queue, { _tag: "Exit", code: live.exit.code })
          Queue.endUnsafe(queue)
          return
        }
        const listener = (item: TerminalItem) => {
          Queue.offerUnsafe(queue, item)
          if (item._tag === "Exit") Queue.endUnsafe(queue)
        }
        live.listeners.add(listener)
        yield* Effect.addFinalizer(() => Effect.sync(() => live.listeners.delete(listener)))
      }),
    )

  return Terminals.of({
    open,
    attach,
    input: (id, data) =>
      Effect.flatMap(lookup(id), (live) =>
        Effect.sync(() => {
          if (!live.terminal.closed) live.terminal.write(data)
        }),
      ),
    resize: (id, cols, rows) =>
      Effect.flatMap(lookup(id), (live) =>
        Effect.sync(() => {
          if (!live.terminal.closed) live.terminal.resize(clampSize(cols, 80), clampSize(rows, 24))
        }),
      ),
    close: (id) =>
      Effect.flatMap(lookup(id), (live) =>
        Effect.sync(() => {
          terminals.delete(id)
          kill(live)
          finish(live, null)
        }),
      ),
    list: Effect.sync(() =>
      [...terminals.values()].map((live) => ({ ...live.info, exit: live.exit })),
    ),
  })
})

/** Terminals are killed when this layer's scope closes (Daemon shutdown). */
export const TerminalsLive = Layer.effect(Terminals, makeTerminals)

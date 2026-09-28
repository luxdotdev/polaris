/**
 * A scriptable stand-in for `codex app-server --listen unix://…`, for tests.
 * It speaks the same transport (WebSocket over a Unix socket, one JSON-RPC
 * message per text frame), so the driver under test runs its real connection
 * code.
 */
import type { ServerWebSocket } from "bun"

export interface ClientRequest {
  readonly id: number | string
  readonly method: string
  readonly params: unknown
}

export interface FakeConnection {
  /** Answer the client request currently being handled. */
  readonly reply: (result: unknown) => void
  readonly replyError: (code: number, message: string) => void
  readonly notify: (method: string, params: unknown) => void
  /** A server→client request; resolves with the client's `result` (or `{ error }`). */
  readonly request: (method: string, params: unknown) => Promise<unknown>
  /** Drop the connection, as if app-server exited. */
  readonly drop: () => void
}

export type Handler = (request: ClientRequest, conn: FakeConnection) => void | Promise<void>

export interface FakeAppServer {
  /** Every client message, in arrival order (requests, notifications and responses). */
  readonly received: Array<Record<string, unknown>>
  readonly requests: (method: string) => Array<ClientRequest>
  readonly stop: () => void
}

export const startFakeAppServer = (socketPath: string, handler: Handler): FakeAppServer => {
  const received: Array<Record<string, unknown>> = []
  let nextServerId = 1000
  const waiting = new Map<string, (value: unknown) => void>()

  const connectionFor = (ws: ServerWebSocket<unknown>, current: ClientRequest | null) => {
    const send = (message: object) => ws.send(JSON.stringify(message))
    return {
      reply: (result) => send({ id: current?.id, result }),
      replyError: (code, message) => send({ id: current?.id, error: { code, message } }),
      notify: (method, params) => send({ method, params }),
      request: (method, params) =>
        new Promise((resolve) => {
          const id = nextServerId++
          waiting.set(String(id), resolve)
          send({ id, method, params })
        }),
      drop: () => ws.close(1011, "app-server exited"),
    } satisfies FakeConnection
  }

  const server = Bun.serve({
    unix: socketPath,
    fetch: (req, srv) =>
      srv.upgrade(req) ? undefined : new Response("upgrade required", { status: 426 }),
    websocket: {
      message: async (ws, data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>
        received.push(message)
        const { id, method, params } = message as {
          id?: number | string
          method?: string
          params?: unknown
        }
        if (method === undefined) {
          const resolve = waiting.get(String(id))
          waiting.delete(String(id))
          resolve?.(message.error === undefined ? message.result : { error: message.error })
          return
        }
        if (id === undefined) return
        await handler({ id, method, params }, connectionFor(ws, { id, method, params }))
      },
    },
  })

  return {
    received,
    requests: (method) =>
      received
        .filter((m) => m.method === method && m.id !== undefined)
        .map((m) => ({ id: m.id as number, method, params: m.params })),
    stop: () => server.stop(true),
  }
}

/** One recorded frame: `out` is client→server, `in` is server→client. */
export interface Frame {
  readonly dir: "in" | "out"
  readonly msg: Record<string, unknown>
}

export const readFixture = async (path: string): Promise<ReadonlyArray<Frame>> =>
  (await Bun.file(path).text())
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Frame)

/**
 * Replays a recorded session: for each client request, finds the next recorded
 * request with that method and sends back what the real app-server sent until
 * the client's next recorded message, rewriting the response id.
 */
export const replay = (frames: ReadonlyArray<Frame>): Handler => {
  let cursor = 0
  return (request, conn) => {
    const at = frames.findIndex(
      (f, i) => i >= cursor && f.dir === "out" && f.msg.method === request.method,
    )
    if (at < 0) return conn.replyError(-32601, `fixture has no further ${request.method}`)
    const recordedId = frames[at]!.msg.id
    let i = at + 1
    for (; i < frames.length && frames[i]!.dir === "in"; i++) {
      const msg = frames[i]!.msg
      if (msg.method !== undefined) conn.notify(msg.method as string, msg.params)
      else if (msg.id === recordedId)
        if (msg.error !== undefined) {
          const error = msg.error as { code: number; message: string }
          conn.replyError(error.code, error.message)
        } else conn.reply(msg.result)
    }
    cursor = i
  }
}

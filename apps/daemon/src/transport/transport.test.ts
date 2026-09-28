/**
 * Loopback tests: an in-process Daemon server on a temp socket, real
 * HostConnections from @polaris/client, and `polaris bridge` as a child
 * process standing in for `ssh <host> polaris bridge`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { type ChildProcess, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  type ConnectionStatus,
  type HostConnection,
  type HostConnectionOptions,
  makeHostConnection,
  spawnTransport,
} from "@polaris/client"
import {
  Attachment,
  AttachmentId,
  CommandId,
  CommandRejected,
  EventEnvelope,
  type HostStreamItem,
  NotFound,
  Sequence,
  TerminalLaunch,
  WorkspaceId,
} from "@polaris/protocol"
import { Context, Effect, Exit, Fiber, Layer, PubSub, Scope, Stream, SubscriptionRef } from "effect"
import { ClientCapabilities, DeviceLabel } from "../engine/rpc.ts"
import { GitRpcsLive } from "../git/GitRpcs.ts"
import { BlobChannel } from "../services.ts"
import type { DaemonAlreadyRunning } from "./lock.ts"
import { ServerRpcs } from "./rpcs.ts"
import { startServer } from "./server.ts"

const MAIN = join(import.meta.dir, "..", "main.ts")

let home: string
beforeEach(() => {
  // Short path: Unix socket paths are limited to ~104 bytes on macOS.
  home = mkdtempSync("/tmp/plt-")
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

const socketOf = (dir: string) => join(dir, "daemon.sock")
const serverOptions = (dir: string) => ({
  socketPath: socketOf(dir),
  lockPath: join(dir, "daemon.lock"),
  root: dir,
})

const bytes = (n: number, seed: number) => {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = (i * 31 + seed) % 256
  return out
}
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")

/** A tiny event log standing in for the store: survives server restarts. */
const makeLog = Effect.gen(function* () {
  const pubsub = yield* PubSub.unbounded<EventEnvelope>()
  const events: Array<EventEnvelope> = []
  const append = Effect.suspend(() => {
    const envelope = new EventEnvelope({
      sequence: Sequence.make(events.length + 1),
      occurredAt: new Date().toISOString(),
      commandId: null,
      event: { _tag: "WorkspaceRemoved", workspaceId: WorkspaceId.make(`w${events.length + 1}`) },
    })
    events.push(envelope)
    return PubSub.publish(pubsub, envelope)
  })
  const subscribeHost = (afterSequence: number | null): Stream.Stream<HostStreamItem> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const live = yield* PubSub.subscribe(pubsub)
        const upTo = events.length
        const head: Array<HostStreamItem> =
          afterSequence === null
            ? [
                {
                  _tag: "Snapshot",
                  sequence: Sequence.make(upTo),
                  workspaces: [],
                  worktrees: [],
                  sessions: [],
                },
              ]
            : events
                .slice(afterSequence, upTo)
                .map((envelope) => ({ _tag: "Event" as const, envelope }))
        return Stream.concat(
          Stream.fromIterable([
            ...head,
            { _tag: "Synchronized" as const, sequence: Sequence.make(upTo) },
          ]),
          Stream.fromSubscription(live).pipe(
            Stream.filter((envelope) => envelope.sequence > upTo),
            Stream.map((envelope) => ({ _tag: "Event" as const, envelope })),
          ),
        )
      }),
    )
  return { append, subscribeHost, events }
})

type Log = Effect.Success<typeof makeLog>

const testHandlers = (log: Log) =>
  Layer.mergeAll(
    ServerRpcs.toLayerHandler("subscribeHost", ({ afterSequence }) =>
      log.subscribeHost(afterSequence),
    ),
    // Echo the device label hello recorded, to prove the annotation reached other handlers.
    ServerRpcs.toLayerHandler("dispatch", ({ commandId }, { client }) =>
      Effect.fail(
        new CommandRejected({
          commandId,
          reason: Context.getOrUndefined(client.annotations, DeviceLabel) ?? "none",
        }),
      ),
    ),
    ServerRpcs.toLayerHandler("files.read", ({ length }) =>
      Effect.gen(function* () {
        const blobs = yield* BlobChannel
        const size = length ?? 0
        const blobId = yield* blobs.offer(bytes(size, 7))
        return {
          size,
          mimeType: "application/octet-stream",
          content: { _tag: "Blob" as const, blobId },
        }
      }),
    ),
    ServerRpcs.toLayerHandler("attachments.stage", ({ name, mimeType, blobId }) =>
      Effect.gen(function* () {
        const blobs = yield* BlobChannel
        const received = yield* Effect.orDie(blobs.take(blobId))
        return new Attachment({
          id: AttachmentId.make("a1"),
          name,
          mimeType,
          size: received.byteLength,
          hostPath: sha(received),
        })
      }),
    ),
    ServerRpcs.toLayerHandler("subscribeSession", ({ sessionId }) =>
      Stream.fail(new NotFound({ what: "session", id: sessionId })),
    ),
  )

const identity = {
  name: "polaris-test",
  version: "0.0.0",
  deviceLabel: "Test MacBook",
  capabilities: ["blobs" as const, "files.read" as const],
}

const fastPolicy = {
  initialDelayMs: 20,
  maxDelayMs: 200,
  needsAttentionRetryMs: 100,
  restartGraceMs: 5_000,
  helloTimeoutMs: 5_000,
}

const localHost = (dir: string, extra: Partial<HostConnectionOptions> = {}) =>
  makeHostConnection({
    key: "local",
    name: "Local",
    target: { _tag: "Local", socketPath: socketOf(dir) },
    identity,
    policy: fastPolicy,
    ...extra,
  })

const bridgeHost = (dir: string) =>
  makeHostConnection({
    key: "bridge",
    name: "Bridge",
    target: { _tag: "Ssh", alias: "unused" },
    identity,
    policy: fastPolicy,
    connector: spawnTransport(["bun", MAIN, "bridge"], {
      env: { ...process.env, POLARIS_HOME: dir },
    }),
  })

const waitFor = (conn: HostConnection, predicate: (s: ConnectionStatus) => boolean) =>
  conn.changes.pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map((o) => o._tag === "Some" && o.value),
  )

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect))

describe("transport", () => {
  test("hello round-trip, device label and placeholders", async () => {
    const result = await run(
      Effect.gen(function* () {
        const server = yield* startServer(serverOptions(home))
        const conn = yield* localHost(home)
        const session = yield* conn.awaitSession
        const status = yield* conn.session.pipe(
          Effect.andThen(() => SubscriptionRef.get(conn.status)),
        )
        const rejected = yield* Effect.flip(
          session.client.dispatch({
            commandId: CommandId.make("c1"),
            command: { _tag: "RemoveWorkspace", workspaceId: WorkspaceId.make("w1") },
          }),
        )
        const hostItems = yield* session.client
          .subscribeHost({ afterSequence: null })
          .pipe(Stream.take(2), Stream.runCollect)
        const modes = {
          socket: statSync(socketOf(home)).mode & 0o777,
          dir: statSync(home).mode & 0o777,
        }
        return { server, session, status, rejected, hostItems, modes }
      }),
    )
    expect(result.session.host.hostId).toBe(result.server.hostInfo.hostId)
    expect(result.session.host.platform).toBe(`${process.platform}-${process.arch}` as never)
    expect(result.session.capabilities).toEqual(["blobs"])
    expect(result.status.state).toBe("connected")
    // The placeholder dispatch rejects; the device label only shows with the test handlers.
    expect(result.rejected._tag).toBe("CommandRejected")
    expect(result.hostItems.map((i) => i._tag)).toEqual(["Snapshot", "Synchronized"])
    expect(result.modes).toEqual({ socket: 0o600, dir: 0o700 })
    // The socket is removed when the Daemon stops.
    expect(existsSync(socketOf(home))).toBe(false)
  })

  test("handlers see the device label from hello", async () => {
    const reason = await run(
      Effect.gen(function* () {
        const log = yield* makeLog
        yield* startServer({ ...serverOptions(home), handlers: testHandlers(log) })
        const conn = yield* localHost(home)
        const session = yield* conn.awaitSession
        const error = yield* Effect.flip(
          session.client.dispatch({
            commandId: CommandId.make("c1"),
            command: { _tag: "RemoveWorkspace", workspaceId: WorkspaceId.make("w1") },
          }),
        )
        return error._tag === "CommandRejected" ? error.reason : error._tag
      }),
    )
    expect(reason).toBe("Test MacBook")
  })

  test("handlers see the Client's capabilities from hello; session.terminalCommand is served", async () => {
    const result = await run(
      Effect.gen(function* () {
        const log = yield* makeLog
        const handlers = Layer.merge(
          testHandlers(log),
          // Echo the capabilities hello recorded, as the terminal command's argv.
          ServerRpcs.toLayerHandler("session.terminalCommand", (_, { client }) =>
            Effect.succeed(
              new TerminalLaunch({
                argv: [...(Context.getOrUndefined(client.annotations, ClientCapabilities) ?? [])],
                cwd: "/repo",
                env: {},
              }),
            ),
          ),
        )
        yield* startServer({ ...serverOptions(home), handlers })
        const conn = yield* localHost(home, {
          identity: { ...identity, capabilities: [...identity.capabilities, "session.live-items"] },
        })
        const session = yield* conn.awaitSession
        return yield* session.client["session.terminalCommand"]({ sessionId: "s" as never })
      }),
    )
    expect(result?.argv).toEqual(["blobs", "files.read", "session.live-items"])
    // Without a real engine the placeholder answers NotFound.
    const missing = await run(
      Effect.gen(function* () {
        yield* startServer(serverOptions(home))
        const conn = yield* localHost(home)
        const session = yield* conn.awaitSession
        return yield* Effect.flip(
          session.client["session.terminalCommand"]({ sessionId: "s" as never }),
        )
      }),
    )
    expect(missing._tag).toBe("NotFound")
  })

  test("streams events and moves multi-MB blobs both ways, interleaved", async () => {
    const result = await run(
      Effect.gen(function* () {
        const log = yield* makeLog
        yield* startServer({ ...serverOptions(home), handlers: testHandlers(log) })
        const conn = yield* localHost(home)
        const session = yield* conn.awaitSession

        const collected = yield* Effect.forkChild(
          conn.subscribeHost.pipe(
            Stream.filter((i) => i._tag === "Event"),
            Stream.take(50),
            Stream.runCollect,
          ),
        )
        yield* Effect.sleep(50)
        const appends = Effect.forkChild(
          Effect.forEach(
            Array.from({ length: 50 }),
            () => Effect.andThen(log.append, Effect.sleep(1)),
            {
              discard: true,
            },
          ),
        )
        yield* appends
        // While events flow, a 6 MB read and a 5 MB upload share the connection.
        const read = yield* session.client["files.read"]({
          path: "/x",
          offset: null,
          length: 6_000_000,
        })
        const readBytes =
          read.content._tag === "Blob" ? yield* session.blobs.take(read.content.blobId) : null
        const upload = bytes(5_000_000, 3)
        const staged = yield* conn.withBlob(upload, (blobId, s) =>
          s.client["attachments.stage"]({
            sessionId: null,
            workspaceId: WorkspaceId.make("w"),
            name: "big.bin",
            mimeType: "application/octet-stream",
            blobId,
          }),
        )
        const events = yield* Fiber.join(collected)
        return { readBytes, staged, upload, events }
      }),
    )
    expect(result.readBytes?.byteLength).toBe(6_000_000)
    expect(sha(result.readBytes!)).toBe(sha(bytes(6_000_000, 7)))
    expect(result.staged.size).toBe(5_000_000)
    expect(result.staged.hostPath).toBe(sha(result.upload))
    expect(
      result.events.map((e) => (e._tag === "Event" ? Number(e.envelope.sequence) : -1)),
    ).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
  }, 20_000)

  test("many Clients connect at once and get the same stream", async () => {
    const seen = await run(
      Effect.gen(function* () {
        const log = yield* makeLog
        const server = yield* startServer({ ...serverOptions(home), handlers: testHandlers(log) })
        const conns = yield* Effect.forEach(Array.from({ length: 6 }), (_, i) =>
          localHost(home, { key: `c${i}` }),
        )
        yield* Effect.forEach(conns, (c) => c.awaitSession, { concurrency: "unbounded" })
        const fibers = yield* Effect.forEach(conns, (c) =>
          Effect.forkChild(
            c.subscribeHost.pipe(
              Stream.filter((i) => i._tag === "Event"),
              Stream.take(10),
              Stream.map((i) => (i._tag === "Event" ? Number(i.envelope.sequence) : 0)),
              Stream.runCollect,
            ),
          ),
        )
        yield* Effect.sleep(100)
        for (let i = 0; i < 10; i++) yield* log.append
        const results = yield* Effect.forEach(fibers, Fiber.join)
        return { results, connections: server.connections() }
      }),
    )
    expect(seen.connections).toBe(6)
    for (const r of seen.results) expect(r).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  }, 15_000)

  test("reconnects and resumes the host stream with no gaps or duplicates", async () => {
    const result = await run(
      Effect.gen(function* () {
        const log = yield* makeLog
        const startOn = () =>
          Effect.gen(function* () {
            const scope = yield* Scope.make()
            yield* startServer({ ...serverOptions(home), handlers: testHandlers(log) }).pipe(
              Scope.provide(scope),
            )
            return scope
          })
        let serverScope = yield* startOn()
        const conn = yield* localHost(home)
        yield* conn.awaitSession
        const states: Array<string> = []
        yield* conn.changes.pipe(
          Stream.runForEach((s) => Effect.sync(() => states.push(s.state))),
          Effect.forkChild,
        )
        const items = yield* Effect.forkChild(
          conn.subscribeHost.pipe(
            Stream.filter((i) => i._tag === "Event"),
            Stream.map((i) => (i._tag === "Event" ? Number(i.envelope.sequence) : 0)),
            Stream.take(90),
            Stream.runCollect,
          ),
        )
        yield* Effect.sleep(50)
        for (let round = 0; round < 3; round++) {
          for (let i = 0; i < 20; i++) yield* log.append
          yield* Effect.sleep(20)
          // Kill the Daemon mid-stream; events keep landing in the store while it's down.
          yield* Scope.close(serverScope, Exit.void)
          for (let i = 0; i < 5; i++) yield* log.append
          yield* waitFor(conn, (s) => s.state === "reconnecting")
          serverScope = yield* startOn()
          yield* waitFor(conn, (s) => s.state === "connected" && s.epoch === round + 2)
          for (let i = 0; i < 5; i++) yield* log.append
        }
        const sequences = yield* Fiber.join(items)
        return { sequences, states, events: log.events.length }
      }),
    )
    expect(result.events).toBe(90)
    expect(result.sequences).toEqual(Array.from({ length: 90 }, (_, i) => i + 1))
    expect(result.states).toContain("reconnecting")
    expect(result.states.filter((s) => s === "connected").length).toBeGreaterThanOrEqual(4)
  }, 20_000)

  test("a late subscriber paints from the cache first", async () => {
    const first = await run(
      Effect.gen(function* () {
        const log = yield* makeLog
        for (let i = 0; i < 3; i++) yield* log.append
        yield* startServer({ ...serverOptions(home), handlers: testHandlers(log) })
        const conn = yield* localHost(home)
        yield* conn.subscribeHost.pipe(Stream.take(2), Stream.runDrain)
        yield* log.append
        // Nothing is subscribed now; the cache holds the snapshot at 3.
        return yield* conn.subscribeHost.pipe(Stream.take(3), Stream.runCollect)
      }),
    )
    expect(first.map((i) => i._tag)).toEqual(["Snapshot", "Synchronized", "Event"])
    expect(first[0]?._tag === "Snapshot" && first[0].sequence).toBe(3 as never)
    expect(first[2]?._tag === "Event" && first[2].envelope.sequence).toBe(4 as never)
  }, 10_000)

  test("session streams surface NotFound", async () => {
    const error = await run(
      Effect.gen(function* () {
        const log = yield* makeLog
        yield* startServer({ ...serverOptions(home), handlers: testHandlers(log) })
        const conn = yield* localHost(home)
        return yield* conn.subscribeSession("nope" as never).pipe(Stream.runDrain, Effect.flip)
      }),
    )
    expect(error._tag).toBe("NotFound")
  })

  test("the lock stops a second Daemon, in process and as a process", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* startServer(serverOptions(home))
        const second = yield* startServer(serverOptions(home)).pipe(Effect.flip, Effect.scoped)
        const child = yield* Effect.promise(() =>
          runProcess(["bun", MAIN, "serve"], { POLARIS_HOME: home }),
        )
        return { second: second as DaemonAlreadyRunning, child }
      }),
    )
    expect(result.second._tag).toBe("DaemonAlreadyRunning")
    expect(result.child.code).toBe(75)
    expect(result.child.stderr).toContain("already running")
  }, 15_000)

  test("takes over a stale socket left by a killed Daemon", async () => {
    const path = socketOf(home)
    const child = spawn("bun", [
      "-e",
      `require("node:net").createServer().listen(${JSON.stringify(path)}, () => console.log("up"))`,
    ])
    await new Promise<void>((resolve) => child.stdout?.once("data", () => resolve()))
    child.kill("SIGKILL")
    await new Promise((resolve) => child.once("exit", resolve))
    expect(existsSync(path)).toBe(true)

    const host = await run(
      Effect.gen(function* () {
        yield* startServer(serverOptions(home))
        const conn = yield* localHost(home)
        return (yield* conn.awaitSession).host
      }),
    )
    expect(host.hostname.length).toBeGreaterThan(0)
  })

  test("polaris bridge pipes a Client to the Daemon", async () => {
    const result = await run(
      Effect.gen(function* () {
        const log = yield* makeLog
        yield* startServer({ ...serverOptions(home), handlers: testHandlers(log) })
        const conn = yield* bridgeHost(home)
        const session = yield* conn.awaitSession
        const read = yield* session.client["files.read"]({
          path: "/x",
          offset: null,
          length: 3_000_000,
        })
        const got =
          read.content._tag === "Blob" ? yield* session.blobs.take(read.content.blobId) : null
        const staged = yield* conn.withBlob(bytes(2_000_000, 9), (blobId, s) =>
          s.client["attachments.stage"]({
            sessionId: null,
            workspaceId: WorkspaceId.make("w"),
            name: "b",
            mimeType: "x/y",
            blobId,
          }),
        )
        return { host: session.host, got, staged }
      }),
    )
    expect(result.got && sha(result.got)).toBe(sha(bytes(3_000_000, 7)))
    expect(result.staged.hostPath).toBe(sha(bytes(2_000_000, 9)))
  }, 15_000)

  test("no Daemon behind the bridge is Needs Attention, and it recovers", async () => {
    const result = await run(
      Effect.gen(function* () {
        const conn = yield* bridgeHost(home)
        yield* waitFor(conn, (s) => s.state === "needs-attention")
        const status = yield* SubscriptionRef.get(conn.status)
        yield* startServer(serverOptions(home))
        yield* conn.retryNow
        yield* waitFor(conn, (s) => s.state === "connected")
        return status
      }),
    )
    expect(result.failure?.reason).toBe("daemon-not-running")
  }, 15_000)

  test("another module's handlers get their connection's BlobChannel (git.diff)", async () => {
    const repo = join(home, "repo")
    const git = (...args: Array<string>) => {
      const r = Bun.spawnSync(["git", "-C", repo, ...args], {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@t",
        },
      })
      if (r.exitCode !== 0) throw new Error(r.stderr.toString())
    }
    Bun.spawnSync(["git", "init", "-q", repo])
    await Bun.write(join(repo, "big.txt"), "a\n".repeat(400_000))
    git("add", ".")
    git("commit", "-qm", "init")
    await Bun.write(join(repo, "big.txt"), "b\n".repeat(400_000))

    const diff = await run(
      Effect.gen(function* () {
        yield* startServer({ ...serverOptions(home), handlers: GitRpcsLive })
        const conn = yield* localHost(home)
        const session = yield* conn.awaitSession
        const result = yield* session.client["git.diff"]({
          cwd: repo,
          spec: { _tag: "WorkingTree", base: null },
        })
        const text = new TextDecoder().decode(yield* session.blobs.take(result.blobId))
        return { result, text }
      }),
    )
    // (`files` is not checked: git/diff.ts counts over an ArrayBuffer and reports 0; see README.)
    expect(diff.text.length).toBe(diff.result.size)
    expect(diff.text).toContain("+b")
  }, 20_000)

  test("polaris serve as a process: pid file, bridge, clean shutdown", async () => {
    const env = { ...process.env, POLARIS_HOME: home }
    const daemon = spawn("bun", [MAIN, "serve"], { env, stdio: "ignore" })
    try {
      for (let i = 0; i < 100 && !existsSync(join(home, "daemon.pid")); i++) await Bun.sleep(50)
      const host = await run(
        Effect.gen(function* () {
          const conn = yield* bridgeHost(home)
          return (yield* conn.awaitSession).host
        }),
      )
      expect(host.daemonVersion.length).toBeGreaterThan(0)
      expect(Number((await Bun.file(join(home, "daemon.pid")).text()).trim())).toBe(daemon.pid!)
      expect(Number((await Bun.file(join(home, "daemon.lock")).text()).trim())).toBe(daemon.pid!)
    } finally {
      daemon.kill("SIGTERM")
      await new Promise((resolve) => daemon.once("exit", resolve))
    }
    for (const file of ["daemon.sock", "daemon.lock", "daemon.pid"])
      expect(existsSync(join(home, file))).toBe(false)
  }, 20_000)
})

const runProcess = (argv: Array<string>, env: Record<string, string>) =>
  new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const [command, ...args] = argv
    const child: ChildProcess = spawn(command!, args, { env: { ...process.env, ...env } })
    let stderr = ""
    child.stderr?.on("data", (d) => {
      stderr += String(d)
    })
    const timer = setTimeout(() => child.kill("SIGKILL"), 8000)
    child.once("exit", (code) => {
      clearTimeout(timer)
      resolve({ code, stderr })
    })
  })

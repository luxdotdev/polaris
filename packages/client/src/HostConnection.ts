/**
 * A Client's link to one Host's Daemon, with its Connection State.
 *
 * Connection State policy (CONTEXT.md: Connected, Reconnecting, Needs
 * Attention, Offline), never prompting:
 *
 * - Before the first connection and after a drop: Reconnecting. Retries back
 *   off exponentially from `initialDelayMs` to `maxDelayMs` (2 minutes), with
 *   jitter; the first retry after a drop is immediate-ish.
 * - A failure only the user can fix (changed or unknown host key, auth
 *   failure, broken ssh config, missing ssh) is Needs Attention and stops
 *   automatic retries until `retryNow` (so we never hammer sshd with failing
 *   auth). A failure the install/upgrade flow can fix (polaris not installed,
 *   no Daemon running, protocol mismatch) is also Needs Attention but is
 *   re-checked every `needsAttentionRetryMs`.
 * - Transient failures that go on for `offlineAfterMs` (10 minutes) since the
 *   last good connection make the Host Offline; it is then retried every
 *   `offlineRetryMs` (10 minutes) or on demand via `retryNow`.
 */
import {
  type BlobId,
  type Capability,
  type ConnectionState,
  type HostInfo,
  type HostStreamItem,
  type NotFound,
  PROTOCOL_VERSION,
  type SessionId,
  type SessionStreamItem,
} from "@polaris/protocol"
import { Effect, Option, Predicate, Queue, Scope, Stream, SubscriptionRef } from "effect"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import { ConnectFailure } from "./failures.ts"
import { type Feed, makeFeed, type SequenceMark } from "./resume.ts"
import {
  type ClientBlobs,
  connectRpc,
  type DaemonClient,
  type RpcConnectionOptions,
} from "./rpc.ts"
import { defaultControlDir, ensureControlDir, type SshOptions, sshArgv } from "./ssh.ts"
import { type Connector, socketTransport, spawnTransport } from "./transport.ts"

export type HostTarget =
  | { readonly _tag: "Local"; readonly socketPath: string }
  | {
      readonly _tag: "Ssh"
      readonly alias: string
      /** Per-Host toggle; off by default. */
      readonly forwardAgent?: boolean
    }

export interface ClientIdentity {
  readonly name: string
  readonly version: string
  /** Shown to other Clients, e.g. "MacBook Pro". */
  readonly deviceLabel: string
  readonly capabilities: ReadonlyArray<Capability>
}

export interface ReconnectPolicy {
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly factor: number
  readonly jitter: number
  readonly offlineAfterMs: number
  readonly offlineRetryMs: number
  readonly needsAttentionRetryMs: number
  readonly helloTimeoutMs: number
  /** After a drop, how long "no Daemon running" still counts as a restart (Reconnecting). */
  readonly restartGraceMs: number
}

export const DEFAULT_POLICY: ReconnectPolicy = {
  initialDelayMs: 500,
  maxDelayMs: 120_000,
  factor: 2,
  jitter: 0.2,
  offlineAfterMs: 10 * 60_000,
  offlineRetryMs: 10 * 60_000,
  needsAttentionRetryMs: 120_000,
  helloTimeoutMs: 20_000,
  restartGraceMs: 30_000,
}

export interface HostConnectionOptions {
  /** Stable key in the HostRegistry, e.g. "local" or the SSH alias. */
  readonly key: string
  /** Display name, e.g. "Mac Studio". */
  readonly name: string
  readonly target: HostTarget
  readonly identity: ClientIdentity
  /** Replaces the transport the target implies; tests spawn `polaris bridge` directly. */
  readonly connector?: Connector
  readonly policy?: Partial<ReconnectPolicy>
  readonly rpc?: RpcConnectionOptions
  readonly ssh?: SshOptions
}

export interface ConnectionStatus {
  readonly state: ConnectionState
  /** The most recent failure; the reason shown for Reconnecting / Needs Attention / Offline. */
  readonly failure: ConnectFailure | null
  /** Consecutive failed attempts since the last good connection. */
  readonly attempt: number
  /** When the current state began (ms since epoch). */
  readonly since: number
  /** When the next automatic attempt is due, or null if none is scheduled. */
  readonly nextAttemptAt: number | null
  /** The Host as last seen; kept while not connected so the UI can dim it. */
  readonly host: HostInfo | null
  /** Capabilities both this Client and the Daemon support. */
  readonly capabilities: ReadonlyArray<Capability>
  /** Increments on every successful connection. */
  readonly epoch: number
}

/** One live connection: an RPC client and its blob channel. Invalid once the epoch changes. */
export interface LiveSession {
  readonly epoch: number
  readonly client: DaemonClient
  readonly blobs: ClientBlobs
  readonly host: HostInfo
  readonly capabilities: ReadonlyArray<Capability>
}

export class NotConnected extends Error {
  readonly _tag = "NotConnected"
  constructor(readonly status: ConnectionStatus) {
    super(`not connected (${status.state})`)
  }
}

export interface HostConnection {
  readonly key: string
  readonly name: string
  readonly status: SubscriptionRef.SubscriptionRef<ConnectionStatus>
  /** The current status, then every change. */
  readonly changes: Stream.Stream<ConnectionStatus>
  /** The live session, or NotConnected right away. */
  readonly session: Effect.Effect<LiveSession, NotConnected>
  /** Waits until connected. */
  readonly awaitSession: Effect.Effect<LiveSession>
  /** Resumable host stream; see resume.ts. */
  readonly subscribeHost: Stream.Stream<HostStreamItem>
  /** Resumable session stream; fails only if the Daemon says the session doesn't exist. */
  readonly subscribeSession: (
    sessionId: SessionId,
    options?: { readonly turnLimit?: number | null },
  ) => Stream.Stream<SessionStreamItem, NotFound>
  /** Send bytes, then call the RPC that consumes them, on the same connection. */
  readonly withBlob: <A, E>(
    bytes: Uint8Array,
    use: (blobId: BlobId, session: LiveSession) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | NotConnected>
  /** Try now, whatever the state (e.g. after the user fixed their ssh config). */
  readonly retryNow: Effect.Effect<void>
}

const isDisconnect = (error: unknown): error is RpcClientError =>
  Predicate.isTagged(error, "RpcClientError")

const markHost = (item: HostStreamItem): SequenceMark => {
  switch (item._tag) {
    case "Snapshot":
      return { kind: "snapshot", sequence: item.sequence }
    case "Event":
      return { kind: "event", sequence: item.envelope.sequence }
    case "Synchronized":
      return { kind: "synchronized", sequence: item.sequence }
  }
}

const markSession = (item: SessionStreamItem): SequenceMark => {
  switch (item._tag) {
    case "Snapshot":
      return { kind: "snapshot", sequence: item.sequence }
    case "Event":
      return { kind: "event", sequence: item.envelope.sequence }
    case "Synchronized":
      return { kind: "synchronized", sequence: item.sequence }
    case "Delta":
      return { kind: "ephemeral" }
  }
}

/** Reasons the user must fix; no automatic retry until `retryNow`. */
const MANUAL_REASONS = new Set<string>([
  "host-key-changed",
  "host-key-unknown",
  "auth-failed",
  "ssh-config-error",
  "ssh-missing",
  "command-missing",
])

const connectorFor = (options: HostConnectionOptions): Connector => {
  if (options.connector !== undefined) return options.connector
  const target = options.target
  if (target._tag === "Local") return socketTransport(target.socketPath)
  return Effect.suspend(() => {
    const controlDir = options.ssh?.controlDir ?? defaultControlDir()
    ensureControlDir(controlDir)
    return spawnTransport(
      sshArgv(target.alias, {
        ...options.ssh,
        controlDir,
        forwardAgent: target.forwardAgent ?? false,
      }),
    )
  })
}

export const makeHostConnection = Effect.fnUntraced(function* (
  options: HostConnectionOptions,
): Effect.fn.Return<HostConnection, never, Scope.Scope> {
  const policy: ReconnectPolicy = { ...DEFAULT_POLICY, ...options.policy }
  const connector = connectorFor(options)

  const status = yield* SubscriptionRef.make<ConnectionStatus>({
    state: "reconnecting",
    failure: null,
    attempt: 0,
    since: Date.now(),
    nextAttemptAt: null,
    host: null,
    capabilities: [],
    epoch: 0,
  })
  const live = yield* SubscriptionRef.make<LiveSession | null>(null)
  const retrySignal = yield* Queue.sliding<void>(1)

  const setStatus = (patch: Partial<ConnectionStatus>) =>
    SubscriptionRef.update(status, (current) => {
      const next = { ...current, ...patch }
      return next.state === current.state ? next : { ...next, since: Date.now() }
    })

  /** One connection attempt; returns only by failing, when the attempt or the connection ends. */
  const connectOnce = (epoch: number) =>
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* connector
        const connection = yield* connectRpc(transport, options.rpc)
        const hello = yield* connection.client
          .hello({
            clientName: options.identity.name,
            clientVersion: options.identity.version,
            deviceLabel: options.identity.deviceLabel,
            capabilities: options.identity.capabilities,
          })
          .pipe(
            Effect.timeoutOrElse({
              duration: policy.helloTimeoutMs,
              orElse: () =>
                Effect.fail(
                  new ConnectFailure({
                    kind: "transient",
                    reason: "timeout",
                    detail: "the Daemon did not answer hello",
                  }),
                ),
            }),
            Effect.catch((error) =>
              error instanceof ConnectFailure
                ? Effect.fail(error)
                : Effect.flip(transport.diagnose),
            ),
          )
        if (hello.protocolVersion !== PROTOCOL_VERSION) {
          return yield* new ConnectFailure({
            kind: "needs-attention",
            reason: "protocol-mismatch",
            detail: `the Daemon speaks protocol ${hello.protocolVersion}, this Client ${PROTOCOL_VERSION}`,
          })
        }
        const capabilities = hello.capabilities.filter((c) =>
          options.identity.capabilities.includes(c),
        )
        const session: LiveSession = {
          epoch,
          client: connection.client,
          blobs: connection.blobs,
          host: hello.host,
          capabilities,
        }
        yield* Effect.addFinalizer(() =>
          SubscriptionRef.update(live, (current) => (current === session ? null : current)),
        )
        yield* setStatus({
          state: "connected",
          failure: null,
          attempt: 0,
          nextAttemptAt: null,
          host: hello.host,
          capabilities,
          epoch,
        })
        yield* SubscriptionRef.set(live, session)
        return yield* connection.lost.pipe(Effect.catch(() => Effect.flip(transport.diagnose)))
      }),
    )

  /** Waits out the delay; true if the user asked to retry now. */
  const waitForRetry = (delayMs: number | null): Effect.Effect<boolean> =>
    delayMs === null
      ? Effect.as(Queue.take(retrySignal), true)
      : Effect.raceFirst(
          Effect.as(Effect.sleep(delayMs), false),
          Effect.as(Queue.take(retrySignal), true),
        )

  const backoff = (attempt: number) => {
    const base = Math.min(policy.maxDelayMs, policy.initialDelayMs * policy.factor ** attempt)
    const spread = base * policy.jitter
    return Math.round(base - spread + Math.random() * 2 * spread)
  }

  const loop = Effect.gen(function* () {
    let epoch = 0
    let attempt = 0
    let failingSince = Date.now()
    let lostAt: number | null = null
    while (true) {
      yield* Queue.poll(retrySignal)
      const failure = yield* connectOnce(epoch + 1).pipe(Effect.flip)
      const current = yield* SubscriptionRef.get(status)
      const wasConnected = current.epoch > epoch
      if (wasConnected) {
        epoch = current.epoch
        attempt = 0
        failingSince = Date.now()
        lostAt = failingSince
      } else {
        attempt++
      }
      const now = Date.now()
      let state: ConnectionState
      let delay: number | null
      // Right after a drop, "no Daemon" is most likely a Daemon restart: keep Reconnecting.
      const restarting =
        failure.reason === "daemon-not-running" &&
        lostAt !== null &&
        now - lostAt < policy.restartGraceMs
      if (failure.kind === "needs-attention" && !restarting) {
        state = "needs-attention"
        delay = MANUAL_REASONS.has(failure.reason) ? null : policy.needsAttentionRetryMs
      } else if (now - failingSince >= policy.offlineAfterMs) {
        state = "offline"
        delay = policy.offlineRetryMs
      } else {
        state = "reconnecting"
        delay = wasConnected ? 0 : backoff(attempt - 1)
      }
      yield* setStatus({
        state,
        failure,
        attempt,
        nextAttemptAt: delay === null ? null : now + delay,
      })
      const asked = yield* waitForRetry(delay)
      if (asked) yield* setStatus({ state: "reconnecting", nextAttemptAt: null })
    }
  })

  yield* Effect.forkScoped(loop)

  const nextLive = (minEpoch: number) =>
    SubscriptionRef.changes(live).pipe(
      Stream.filter((s): s is LiveSession => s !== null && s.epoch >= minEpoch),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
    )

  const source = {
    next: (minEpoch: number) =>
      Effect.map(nextLive(minEpoch), (s) => ({ epoch: s.epoch, client: s.client })),
  }

  const hostFeed: Feed<HostStreamItem, never> = yield* makeFeed<
    DaemonClient,
    HostStreamItem,
    never
  >({
    source,
    open: (client, afterSequence) =>
      client.subscribeHost({ afterSequence: afterSequence as never }) as Stream.Stream<
        HostStreamItem,
        never
      >,
    mark: markHost,
    isDisconnect,
    gapless: true,
  })

  const scope = yield* Effect.scope
  const sessionFeeds = new Map<string, Feed<SessionStreamItem, NotFound | RpcClientError>>()
  const MAX_IDLE_SESSION_FEEDS = 32

  const sessionFeed = (sessionId: SessionId, turnLimit: number | null) =>
    Effect.gen(function* () {
      const key = `${sessionId}\u0000${turnLimit ?? ""}`
      const existing = sessionFeeds.get(key)
      if (existing !== undefined) return existing
      const feed = yield* makeFeed<DaemonClient, SessionStreamItem, NotFound | RpcClientError>({
        source,
        open: (client, afterSequence) =>
          client.subscribeSession({
            sessionId,
            afterSequence: afterSequence as never,
            turnLimit,
          }),
        mark: markSession,
        isDisconnect,
        gapless: false,
      }).pipe(Scope.provide(scope))
      sessionFeeds.set(key, feed)
      const idle = [...sessionFeeds].filter(([, f]) => f.subscribers() === 0)
      for (const [k] of idle.slice(0, Math.max(0, idle.length - MAX_IDLE_SESSION_FEEDS)))
        sessionFeeds.delete(k)
      return feed
    })

  const session = Effect.flatMap(SubscriptionRef.get(live), (s) =>
    s !== null
      ? Effect.succeed(s)
      : Effect.flatMap(SubscriptionRef.get(status), (st) => Effect.fail(new NotConnected(st))),
  )

  return {
    key: options.key,
    name: options.name,
    status,
    changes: SubscriptionRef.changes(status),
    session,
    awaitSession: nextLive(0),
    subscribeHost: hostFeed.stream,
    subscribeSession: (sessionId, opts) =>
      Stream.unwrap(
        Effect.map(sessionFeed(sessionId, opts?.turnLimit ?? null), (feed) => feed.stream),
      ) as Stream.Stream<SessionStreamItem, NotFound>,
    withBlob: (bytes, use) =>
      Effect.flatMap(session, (s) =>
        Effect.flatMap(s.blobs.offer(bytes), (blobId) => use(blobId, s)),
      ),
    retryNow: Effect.asVoid(Queue.offer(retrySignal, undefined)),
  }
})

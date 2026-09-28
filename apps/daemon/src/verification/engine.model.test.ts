/**
 * Model-based test of the Engine (ENG-209), through public APIs only:
 * `Engine.dispatch`, `subscribeHost` / `subscribeSession`, the EventStore's
 * read side, the scriptable fake Harness (`engine/testing.ts`), and the
 * Client's resumable feeds (`makeFeed` from @polaris/client, set up as
 * `HostConnection` does).
 *
 * fast-check generates runs of: concurrent bursts of commands from two devices
 * (fresh and retried command ids, stale and racing approval answers, Archive
 * and Unarchive) mixed with Harness events (items, approval requests and
 * withdrawals, Turn ends, and late approval requests for a Turn that ended),
 * in an order and batching `fc.scheduler` picks; pauses of Client feeds (a
 * stalled Client, which the Daemon drops at `subscriberCapacity`); connection
 * drops; and Daemon crashes (the layer torn down, possibly mid-burst, the same
 * SQLite file reopened, and recovery run). After every step:
 *
 *   - the log is gapless, and each command id's events are one decision that a
 *     reference decider agrees with, given the log right before it; each
 *     rejection was right at some point while the command was in flight;
 *   - every answer is backed by committed events, and a retry gets the
 *     original answer;
 *   - each approval request closes at most once, after it was opened; the
 *     first answer wins and the recorded device is the one that was accepted;
 *   - no Turn starts or continues without a Client's command;
 *   - an approval is pending, and a session Working, only with a Turn in
 *     flight; an Archived session holds neither;
 *   - the read model equals a reference fold of the log (also after reloads);
 *   - every Client feed has seen exactly a prefix of its committed stream, and
 *     each Snapshot matches the log at its sequence.
 *
 * Right after a restart, before any command: no Turn is working, no approval
 * is pending, a Turn that was working is Interrupted and its session Needs
 * You, and no Harness was opened (no auto-continue). At the end of a run,
 * every feed catches up with its stream.
 *
 * The same properties are specified in `packages/spec/polaris.qnt`.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { type Feed, makeFeed, type SequenceMark } from "@polaris/client"
import {
  type Command,
  CommandId,
  type EventEnvelope,
  type HostStreamItem,
  type NotFound,
  type RequestId,
  type Sequence,
  type SessionId,
  type SessionStreamItem,
} from "@polaris/protocol"
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Latch,
  ManagedRuntime,
  Option,
  Queue,
  Scope,
  Stream,
} from "effect"
import fc from "fast-check"
import { Engine } from "../engine/Engine.ts"
import {
  engineLayer,
  type FakeDriver,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
} from "../engine/testing.ts"
import { EventStore } from "../store/EventStore.ts"
import type { ReadModel } from "../store/model.ts"
import { eventually, isPrefix, pbtRuns, pbtSeed, pbtTimeout, sleep } from "./pbt.ts"

const TRACE_DIR = process.env.POLARIS_TRACE_DIR

const SESSIONS = ["s1", "s2"] as const
type SessionName = (typeof SESSIONS)[number]
const CLIENTS = ["mac", "phone"] as const
type ClientName = (typeof CLIENTS)[number]
type StreamName = "host" | SessionName
const STREAMS: ReadonlyArray<StreamName> = ["host", ...SESSIONS]

// ── The log, abstracted ─────────────────────────────────────────────────────

interface AEvent {
  readonly seq: number
  readonly commandId: string | null
  readonly session: string | null
  readonly tag: EventEnvelope["event"]["_tag"]
  /** A short, comparable description of what the event says. */
  readonly what: string
  readonly turnId?: string
  readonly status?: string
  readonly state?: string
  readonly requestId?: string
  readonly reason?: string | null
}

const abstractEvent = (envelope: EventEnvelope): AEvent => {
  const e = envelope.event
  const base = { seq: envelope.sequence as number, commandId: envelope.commandId as string | null }
  switch (e._tag) {
    case "SessionCreated":
      return { ...base, session: e.session.id, tag: e._tag, what: e._tag, state: e.session.state }
    case "SessionStateChanged":
      return {
        ...base,
        session: e.sessionId,
        tag: e._tag,
        what: `state:${e.state}`,
        state: e.state,
        reason: e.reason,
      }
    case "TurnStarted":
    case "TurnEnded":
      return {
        ...base,
        session: e.turn.sessionId,
        tag: e._tag,
        what: `${e._tag}:${e.turn.status}`,
        turnId: e.turn.id,
        status: e.turn.status,
      }
    case "ApprovalRequested":
      return {
        ...base,
        session: e.request.sessionId,
        tag: e._tag,
        what: `requested:${e.request.id}`,
        requestId: e.request.id,
        turnId: e.request.turnId,
      }
    case "ApprovalResolved":
      return {
        ...base,
        session: e.sessionId,
        tag: e._tag,
        what: `resolved:${e.requestId}:${e.resolvedBy}`,
        requestId: e.requestId,
      }
    case "ApprovalWithdrawn":
      return {
        ...base,
        session: e.sessionId,
        tag: e._tag,
        what: `withdrawn:${e.requestId}:${e.withdrawnBy}`,
        requestId: e.requestId,
      }
    case "WorkspaceRegistered":
    case "WorkspaceUpdated":
    case "WorkspaceRemoved":
    case "WorktreeDetected":
    case "WorktreeRemoved":
      return { ...base, session: null, tag: e._tag, what: e._tag }
    default:
      return { ...base, session: e.sessionId, tag: e._tag, what: e._tag }
  }
}

const inStream = (e: AEvent, stream: StreamName) =>
  stream === "host"
    ? e.tag !== "TurnItemCompleted" && e.tag !== "CheckpointRecorded"
    : e.session === stream

const streamSeqs = (log: ReadonlyArray<AEvent>, stream: StreamName) =>
  log.filter((e) => inStream(e, stream)).map((e) => e.seq)

// ── Reference model: a fold of the log, and a decider for Client commands ───

interface View {
  state: string
  readonly turns: Map<string, string>
  readonly order: Array<string>
  readonly pending: Set<string>
}

const fold = (log: ReadonlyArray<AEvent>, upTo = log.length): Map<string, View> => {
  const views = new Map<string, View>()
  for (const e of log.slice(0, upTo)) {
    if (e.session === null) continue
    if (e.tag === "SessionCreated") {
      views.set(e.session, { state: e.state!, turns: new Map(), order: [], pending: new Set() })
      continue
    }
    const v = views.get(e.session)
    if (v === undefined) continue
    switch (e.tag) {
      case "SessionStateChanged":
        v.state = e.state!
        break
      case "TurnStarted":
      case "TurnEnded":
        if (!v.turns.has(e.turnId!)) v.order.push(e.turnId!)
        v.turns.set(e.turnId!, e.status!)
        break
      case "ApprovalRequested":
        v.pending.add(e.requestId!)
        break
      case "ApprovalResolved":
      case "ApprovalWithdrawn":
        v.pending.delete(e.requestId!)
        break
    }
  }
  return views
}

const workingTurnOf = (v: View) => v.order.find((id) => v.turns.get(id) === "working")

/** What a command records according to the reference decider, or "reject". */
const referenceDecide = (
  v: View,
  command: Command,
  device: string,
): ReadonlyArray<string> | "reject" => {
  const accepts = () =>
    workingTurnOf(v) === undefined &&
    (["idle", "dormant", "failed"].includes(v.state) ||
      (v.state === "needs-you" && v.pending.size === 0))
  const starting = v.state === "idle" ? "state:working" : "state:starting"
  switch (command._tag) {
    case "SendTurn":
      return accepts() ? ["TurnStarted:working", starting] : "reject"
    case "Continue": {
      const last = v.order.at(-1)
      return last !== undefined && v.turns.get(last) === "interrupted" && accepts()
        ? ["TurnStarted:working", starting]
        : "reject"
    }
    case "RespondToApproval":
      if (!v.pending.has(command.requestId)) return "reject"
      return [
        `resolved:${command.requestId}:${device}`,
        ...(v.pending.size === 1 && v.state === "needs-you" && workingTurnOf(v) !== undefined
          ? ["state:working"]
          : []),
      ]
    case "Interrupt":
      return workingTurnOf(v) === undefined ? "reject" : []
    case "ArchiveSession":
      // Refused while a Turn is in flight, in every state (ENG-209 finding 2).
      if (v.state === "archived" || workingTurnOf(v) !== undefined) return "reject"
      return [...[...v.pending].map((r) => `withdrawn:${r}:daemon`), "state:archived"]
    case "UnarchiveSession":
      return v.state === "archived" ? ["state:dormant"] : "reject"
    case "RenameSession":
      return ["SessionRenamed"]
    default:
      throw new Error(`no reference for ${command._tag}`)
  }
}

// ── Client feeds ────────────────────────────────────────────────────────────

class Disconnected {
  readonly _tag = "Disconnected"
}

/** One Client's connection to the Daemon; `closed` completes when it drops. */
interface Conn {
  readonly epoch: number
  readonly engine: Engine["Service"]
  readonly closed: Deferred.Deferred<void>
}

type Seen =
  | { readonly kind: "snapshot"; readonly seq: number }
  | { readonly kind: "event"; readonly seq: number }

interface FeedState {
  readonly client: ClientName
  readonly stream: StreamName
  readonly gate: Latch.Latch
  /** What the feed's subscriber received, in order. */
  readonly seen: Array<Seen>
  readonly errors: Array<string>
  /** Snapshot contents: session → [state, pending request ids]. */
  readonly snapshots: Array<{
    readonly seq: number
    readonly sessions: Map<string, readonly [string, ReadonlyArray<string>]>
  }>
  feed: Feed<unknown, unknown> | null
  consumer: Fiber.Fiber<unknown, unknown> | null
}

const markHost = (item: HostStreamItem): SequenceMark =>
  item._tag === "Event"
    ? { kind: "event", sequence: item.envelope.sequence }
    : { kind: item._tag === "Snapshot" ? "snapshot" : "synchronized", sequence: item.sequence }

const markSession = (item: SessionStreamItem): SequenceMark => {
  switch (item._tag) {
    case "Snapshot":
      return { kind: "snapshot", sequence: item.sequence }
    case "Event":
      return { kind: "event", sequence: item.envelope.sequence }
    case "Synchronized":
      return { kind: "synchronized", sequence: item.sequence }
    default:
      return { kind: "ephemeral" }
  }
}

const onItem = (fs: FeedState, item: HostStreamItem | SessionStreamItem) => {
  if (item._tag === "Snapshot") {
    reached.feedSnapshots++
    fs.seen.push({ kind: "snapshot", seq: item.sequence })
    const sessions = new Map<string, readonly [string, ReadonlyArray<string>]>()
    const pendingOf = (requests: ReadonlyArray<{ readonly id: RequestId }>) =>
      requests.map((r) => r.id as string).sort()
    if ("sessions" in item) {
      for (const summary of item.sessions) {
        sessions.set(summary.session.id, [
          summary.session.state,
          pendingOf(summary.pendingApprovals),
        ])
      }
    } else {
      sessions.set(item.session.id, [item.session.state, pendingOf(item.pendingApprovals)])
    }
    fs.snapshots.push({ seq: item.sequence, sessions })
  } else if (item._tag === "Event") {
    const seq = item.envelope.sequence as number
    const last = fs.seen.at(-1)
    if (last !== undefined && seq <= last.seq) fs.errors.push(`got ${seq} after ${last.seq}`)
    fs.seen.push({ kind: "event", seq })
  }
}

/** The view a feed's subscriber holds: a Snapshot resets it to the stream up to its sequence. */
const viewOfFeed = (fs: FeedState, log: ReadonlyArray<AEvent>) => {
  let view: Array<number> = []
  for (const s of fs.seen) {
    if (s.kind === "snapshot") view = streamSeqs(log, fs.stream).filter((x) => x <= s.seq)
    else view.push(s.seq)
  }
  return view
}

// ── The world ───────────────────────────────────────────────────────────────

interface Sent {
  readonly id: string
  readonly device: ClientName
  readonly command: Command
  /** The sequence when it was sent, and when it was answered (null: no answer yet). */
  readonly from: number
  to: number | null
  /** "seq:<n>", "seq:null" or "rejected:<reason>"; null while unanswered or lost in a crash. */
  answer: string | null
}

const reached = {
  commands: 0,
  rejected: 0,
  retries: 0,
  answerRaces: 0,
  approvalsResolved: 0,
  withdrawnByHarness: 0,
  withdrawnByDaemon: 0,
  continued: 0,
  archived: 0,
  unarchived: 0,
  lateRequests: 0,
  crashes: 0,
  crashesMidBurst: 0,
  interruptedByRestart: 0,
  feedSnapshots: 0,
  feedDrops: 0,
  disconnects: 0,
}

class World {
  runtime: ManagedRuntime.ManagedRuntime<Engine | EventStore, never> | null = null
  driver: FakeDriver = makeFakeDriver("codex")
  readonly filename = join(tempDir(), "state.sqlite")
  readonly fakes = makeFakes()
  readonly conns = new Map<ClientName, Conn>()
  /** Every command a Client sent, in order; a retry is another entry with the same id. */
  readonly sent: Array<Sent> = []
  /** The sequence right after each restart's recovery (for traces). */
  readonly restarts: Array<number> = []
  readonly feeds: Array<FeedState> = []
  /** Client feeds live outside the Daemon: they outlast its crashes. */
  readonly clientScope = Effect.runSync(Scope.make())
  /** Command ids whose block was already checked against the reference decider. */
  readonly checkedBlocks = new Set<string>()
  requestCounter = 0
  /** Turns a fake Harness already reported ended. */
  readonly endedTurns = new Set<string>()
  itemCounter = 0

  constructor(readonly capacity: number) {}

  get rt() {
    if (this.runtime === null) throw new Error("the Daemon is down")
    return this.runtime
  }

  store() {
    return this.rt.runSync(Effect.map(EventStore, (s) => s))
  }

  model(): ReadModel {
    return this.rt.runSync(Effect.flatMap(EventStore, (s) => s.model))
  }

  async open() {
    this.driver = makeFakeDriver("codex", {
      onInterrupt: (session) => {
        const turn = session.turns.at(-1)
        return turn === undefined
          ? []
          : [{ _tag: "TurnEnded", turnId: turn.turnId, status: "interrupted", error: null }]
      },
    })
    this.runtime = ManagedRuntime.make(
      engineLayer({
        filename: this.filename,
        fakes: this.fakes,
        drivers: [this.driver],
        subscriberCapacity: this.capacity,
      }),
    )
    // Building the layer runs recovery before anything else can happen.
    const engine = await this.rt.runPromise(Effect.map(Engine, (e) => e))
    for (const client of CLIENTS) {
      const epoch = (this.conns.get(client)?.epoch ?? 0) + 1
      this.conns.set(client, { epoch, engine, closed: Deferred.makeUnsafe<void>() })
    }
  }

  /** A Client's connection drops and comes back (the Daemon keeps running). */
  disconnect(client: ClientName) {
    const conn = this.conns.get(client)
    if (conn === undefined || Deferred.isDoneUnsafe(conn.closed)) return
    reached.disconnects++
    Deferred.doneUnsafe(conn.closed, Exit.void)
    this.conns.set(client, { ...conn, epoch: conn.epoch + 1, closed: Deferred.makeUnsafe<void>() })
  }

  /** The Daemon goes away; every connection with it. */
  async crash() {
    const runtime = this.rt
    for (const conn of this.conns.values()) Deferred.doneUnsafe(conn.closed, Exit.void)
    this.runtime = null
    await runtime.dispose()
  }

  /** Every committed event, through the store's public read side, as of one cut. */
  async readLog(): Promise<Array<AEvent>> {
    const store = this.store()
    return this.rt.runPromise(
      Effect.gen(function* () {
        const cut = (yield* store.model).sequence
        const parts = yield* Effect.forEach([null, ...SESSIONS], (sessionId) =>
          store.readEvents({ after: 0, upTo: cut, sessionId: sessionId as SessionId | null }),
        )
        const bySeq = new Map<number, EventEnvelope>()
        for (const part of parts) for (const e of part) bySeq.set(e.sequence, e)
        return [...bySeq.values()].sort((a, b) => a.sequence - b.sequence).map(abstractEvent)
      }),
    )
  }

  private nextConn(client: ClientName, min: number) {
    const conns = this.conns
    return Effect.gen(function* () {
      while (true) {
        const conn = conns.get(client)
        if (conn !== undefined && conn.epoch >= min && !Deferred.isDoneUnsafe(conn.closed)) {
          return { epoch: conn.epoch, client: conn }
        }
        yield* Effect.sleep(2)
      }
    })
  }

  /** Both devices' feeds (host, s1, s2), wired as HostConnection wires them. */
  async startFeeds() {
    for (const client of CLIENTS) {
      for (const stream of STREAMS) {
        const fs: FeedState = {
          client,
          stream,
          gate: Latch.makeUnsafe(true),
          seen: [],
          errors: [],
          snapshots: [],
          feed: null,
          consumer: null,
        }
        const source = { next: (min: number) => this.nextConn(client, min) }
        // The Daemon side runs detached, as across a network: a dropped connection never
        // waits for it. A stalled Client stops reading, so the Daemon side stops pulling
        // (as the RPC server does until the Client acks), and its hub buffer fills up.
        const wire = <A, E>(conn: Conn, upstream: Stream.Stream<A, E>) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const queue = yield* Queue.bounded<A, E | Cause.Done>(1)
              const server = Effect.runFork(
                Stream.runIntoQueue(upstream, queue).pipe(
                  // The Daemon ended the stream on its own: it dropped a stalled subscriber.
                  Effect.tap(() => Effect.sync(() => void reached.feedDrops++)),
                ),
              )
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => void Effect.runFork(Fiber.interrupt(server))),
              )
              return Stream.fromQueue(queue).pipe(
                Stream.tap(() => fs.gate.await),
                Stream.interruptWhen(
                  Deferred.await(conn.closed).pipe(Effect.andThen(Effect.fail(new Disconnected()))),
                ),
              )
            }),
          )
        const feed: Feed<HostStreamItem | SessionStreamItem, unknown> =
          stream === "host"
            ? await Effect.runPromise(
                makeFeed<Conn, HostStreamItem, Disconnected>({
                  source,
                  open: (conn, after) =>
                    wire(conn, conn.engine.subscribeHost(after as Sequence | null)),
                  mark: markHost,
                  isDisconnect: (e) => e instanceof Disconnected,
                  // As HostConnection opens it: the host stream leaves out session-only
                  // events, so it has gaps (ENG-209 finding 1).
                  gapless: false,
                  reopenDelayMs: 1,
                }).pipe(Scope.provide(this.clientScope)),
              )
            : await Effect.runPromise(
                makeFeed<Conn, SessionStreamItem, NotFound | Disconnected>({
                  source,
                  open: (conn, after) =>
                    wire(
                      conn,
                      conn.engine.subscribeSession({
                        sessionId: stream as SessionId,
                        afterSequence: after as Sequence | null,
                        turnLimit: null,
                      }),
                    ),
                  mark: markSession,
                  isDisconnect: (e) => e instanceof Disconnected,
                  gapless: false,
                  reopenDelayMs: 1,
                }).pipe(Scope.provide(this.clientScope)),
              )
        fs.feed = feed as Feed<unknown, unknown>
        fs.consumer = Effect.runFork(
          feed.stream.pipe(
            Stream.runForEach((item) => Effect.sync(() => onItem(fs, item))),
            Effect.catchCause((cause) =>
              Effect.sync(() => void fs.errors.push(Cause.pretty(cause))),
            ),
          ),
        )
        this.feeds.push(fs)
      }
    }
  }

  async dispose() {
    for (const fs of this.feeds) {
      if (fs.consumer !== null) await Effect.runPromise(Fiber.interrupt(fs.consumer))
    }
    await Effect.runPromise(Scope.close(this.clientScope, Exit.void))
    if (this.runtime !== null) await this.crash()
  }

  /** Send a command from a device and record what it heard back. */
  dispatch(device: ClientName, id: string, command: Command): Promise<void> {
    const conn = this.conns.get(device)
    if (this.runtime === null || conn === undefined || Deferred.isDoneUnsafe(conn.closed)) {
      return Promise.resolve()
    }
    const sent: Sent = { id, device, command, from: this.model().sequence, to: null, answer: null }
    this.sent.push(sent)
    reached.commands++
    const runtime = this.runtime
    return Effect.runPromiseExit(
      conn.engine.dispatch({ commandId: CommandId.make(id), command, deviceLabel: device }),
    ).then((exit) => {
      // Answers from a Daemon that died meanwhile never reach the Client.
      if (this.runtime !== runtime) return
      sent.to = this.model().sequence
      if (Exit.isSuccess(exit)) {
        sent.answer = `seq:${exit.value.sequence}`
      } else {
        const error = Cause.findErrorOption(exit.cause)
        if (Option.isSome(error) && error.value._tag === "CommandRejected") {
          reached.rejected++
          sent.answer = `rejected:${error.value.reason}`
        } else if (!Cause.hasInterruptsOnly(exit.cause)) {
          sent.answer = `failed:${Cause.pretty(exit.cause)}`
        }
      }
    })
  }

  /** Something a live Harness of `session` reports (no-op if none runs). */
  harness(session: SessionName, what: HarnessWhat, pick: number) {
    const harness = this.driver.latest(session as SessionId)
    if (harness === undefined || harness.closed || this.runtime === null) return
    const record = this.model().sessions.get(session as SessionId)
    // A Harness reports items, requests and the end of a Turn only for the Turn it is
    // running, until it reports that Turn's end (the spec's `harnessReports` assumes
    // it). Its own view, not the read model's: that one may lag behind what it emitted.
    const sent = harness.turns.at(-1)?.turnId
    if (what === "late") {
      // A stale or misbehaving Harness asks about a Turn it already ended (ENG-209
      // finding 3). Ignored, unless a Continue after a crash resumed that Turn since.
      const ended = harness.turns.map((t) => t.turnId).filter((t) => this.endedTurns.has(t))
      if (ended.length === 0) return
      reached.lateRequests++
      harness.emit({
        _tag: "ApprovalRequested",
        turnId: ended[pick % ended.length]!,
        requestId: `late-${++this.requestCounter}` as RequestId,
        kind: "command",
        title: "Run a command",
        detail: null,
        options: [],
      })
      return
    }
    const turnId = sent !== undefined && !this.endedTurns.has(sent) ? sent : undefined
    if (turnId === undefined && what !== "withdraw") return
    switch (what) {
      case "item":
        harness.emit({
          _tag: "ItemCompleted",
          turnId: turnId!,
          item: { _tag: "AssistantMessage", id: `msg-${++this.itemCounter}`, text: "ok" },
        })
        return
      case "delta":
        harness.emit({ _tag: "ItemDelta", turnId: turnId!, itemId: "m", field: "text", text: "…" })
        return
      case "request":
        harness.emit({
          _tag: "ApprovalRequested",
          turnId: turnId!,
          requestId: `req-${++this.requestCounter}` as RequestId,
          kind: "command",
          title: "Run a command",
          detail: null,
          options: [],
        })
        return
      case "withdraw": {
        const pending = [...(record?.pending.keys() ?? [])]
        if (pending.length === 0) return
        harness.emit({ _tag: "ApprovalWithdrawn", requestId: pending[pick % pending.length]! })
        return
      }
      case "end":
        this.endedTurns.add(turnId!)
        harness.emit({ _tag: "TurnEnded", turnId: turnId!, status: "completed", error: null })
        return
    }
  }
}

// ── Invariants ──────────────────────────────────────────────────────────────

const isTurnStart = (e: AEvent) => e.tag === "TurnStarted"

const checkInvariants = async (world: World) => {
  // Feeds first: whatever they saw must already be in the log read next.
  const feeds = world.feeds.map((fs) => ({
    fs,
    seen: [...fs.seen],
    snapshots: [...fs.snapshots],
    errors: [...fs.errors],
  }))
  const log = await world.readLog()
  const model = world.model()

  // Gapless, and exactly what the read model has folded.
  for (const [i, e] of log.entries()) expect(e.seq).toBe(i + 1)
  expect(model.sequence).toBeGreaterThanOrEqual(log.length)

  // Each command id's events: one contiguous block, one decision.
  const blocks = new Map<string, Array<AEvent>>()
  for (const e of log) {
    if (e.commandId === null) continue
    blocks.set(e.commandId, [...(blocks.get(e.commandId) ?? []), e])
  }
  for (const [id, events] of blocks) {
    const first = events[0]!.seq
    if (!events.every((e, i) => e.seq === first + i)) {
      throw new Error(`${id}'s events are not contiguous: ${events.map((e) => e.seq).join(",")}`)
    }
  }

  // Answers: backed by the log, the same for every retry, and right per the reference decider.
  const byId = new Map<string, Array<Sent>>()
  for (const sent of world.sent) byId.set(sent.id, [...(byId.get(sent.id) ?? []), sent])
  for (const [id, sends] of byId) {
    const answers = sends.flatMap((s) => (s.answer === null ? [] : [s.answer]))
    for (const answer of answers) {
      if (answer.startsWith("failed:")) throw new Error(`${id} failed: ${answer}`)
    }
    if (new Set(answers).size > 1) throw new Error(`${id} was answered differently: ${answers}`)
    const block = blocks.get(id)
    const answer = answers[0]
    if (answer?.startsWith("seq:") && answer !== "seq:null") {
      const seq = Number(answer.slice(4))
      if (block === undefined || block.at(-1)!.seq !== seq) {
        throw new Error(`${id} was acked with ${seq} but its events are ${JSON.stringify(block)}`)
      }
    }
    if (answer?.startsWith("rejected:") && block !== undefined) {
      throw new Error(`${id} was rejected but has events`)
    }
    const first = sends[0]!
    if (block !== undefined && !world.checkedBlocks.has(id)) {
      const start = block[0]!.seq - 1
      const views = fold(log, start)
      const view = views.get(sessionOfCommand(first.command))!
      const expected = referenceDecide(view, first.command, first.device)
      if (expected === "reject" || expected.join(" ") !== block.map((e) => e.what).join(" ")) {
        throw new Error(
          `${id} ${first.command._tag} recorded [${block.map((e) => e.what).join(" ")}]; ` +
            `the reference expected ${expected === "reject" ? "a rejection" : `[${expected.join(" ")}]`}`,
        )
      }
      if (first.command._tag === "Continue") reached.continued++
      world.checkedBlocks.add(id)
    }
    // A rejection must have been right at some point while the command was in flight.
    const rejected = sends.find((s) => s.answer?.startsWith("rejected:") && s.to !== null)
    if (
      rejected !== undefined &&
      block === undefined &&
      !world.checkedBlocks.has(`rejected:${id}`)
    ) {
      const to = Math.min(rejected.to!, log.length)
      let justified = false
      for (let k = rejected.from; k <= to && !justified; k++) {
        const view = fold(log, k).get(sessionOfCommand(rejected.command))!
        justified = referenceDecide(view, rejected.command, rejected.device) === "reject"
      }
      if (!justified) {
        throw new Error(`${id} ${rejected.command._tag} was rejected but was acceptable throughout`)
      }
      world.checkedBlocks.add(`rejected:${id}`)
    }
  }

  // Approvals: closed at most once, after they were opened; the first answer wins.
  const opened = new Map<string, number>()
  const closed = new Map<string, AEvent>()
  for (const e of log) {
    if (e.tag === "ApprovalRequested") {
      if (opened.has(e.requestId!)) throw new Error(`${e.requestId} was requested twice`)
      opened.set(e.requestId!, e.seq)
    }
    if (e.tag === "ApprovalResolved" || e.tag === "ApprovalWithdrawn") {
      if (closed.has(e.requestId!)) throw new Error(`${e.requestId} was closed twice`)
      if (!opened.has(e.requestId!)) throw new Error(`${e.requestId} was closed before it opened`)
      closed.set(e.requestId!, e)
    }
  }
  const accepted = new Map<string, Array<Sent>>()
  for (const sent of world.sent) {
    if (sent.command._tag !== "RespondToApproval" || !sent.answer?.startsWith("seq:")) continue
    const r = sent.command.requestId as string
    if (!(accepted.get(r) ?? []).some((s) => s.id === sent.id)) {
      accepted.set(r, [...(accepted.get(r) ?? []), sent])
    }
  }
  for (const [r, winners] of accepted) {
    if (winners.length > 1) throw new Error(`${r} accepted ${winners.length} answers`)
    const resolved = closed.get(r)
    expect(resolved?.what).toBe(`resolved:${r}:${winners[0]!.device}`)
    expect(resolved?.commandId).toBe(winners[0]!.id)
  }

  // No Turn starts or continues without a Client's command.
  for (const e of log) {
    if (isTurnStart(e) && e.commandId === null)
      throw new Error(`Turn started by itself at ${e.seq}`)
    // A request is recorded only for its session's Turn in flight (late ones are ignored).
    if (e.tag === "ApprovalRequested") {
      const v = fold(log, e.seq - 1).get(e.session!)
      if (v === undefined || workingTurnOf(v) !== e.turnId) {
        throw new Error(`${e.requestId} was recorded at ${e.seq} for ${e.turnId}, not in flight`)
      }
    }
  }

  // Nothing is pending, and no session Working, without a Turn in flight; Archived holds neither.
  for (const [s, v] of fold(log)) {
    const working = workingTurnOf(v) !== undefined
    if (v.pending.size > 0 && !working) throw new Error(`${s} has approvals pending with no Turn`)
    if (v.state === "working" && !working) throw new Error(`${s} is Working with no Turn`)
    if (v.state === "archived" && working) throw new Error(`${s} is Archived with a Turn in flight`)
  }

  // The read model is the reference fold of the log.
  const views = fold(log)
  for (const s of SESSIONS) {
    const record = model.sessions.get(s as SessionId)
    const view = views.get(s)
    if (record === undefined || view === undefined) continue
    if (model.sequence !== log.length) break // it moved on while we read; next step checks it
    expect({ s, state: record.session.state as string }).toEqual({ s, state: view.state })
    expect({ s, pending: [...record.pending.keys()].map(String).sort() }).toEqual({
      s,
      pending: [...view.pending].sort(),
    })
    const last = record.turns.at(-1)
    if (last !== undefined) expect(view.turns.get(last.id)).toBe(last.status)
  }

  // Feeds: a prefix of their stream, no duplicates, Snapshots that match the log.
  for (const { fs, seen, snapshots, errors } of feeds) {
    const label = `${fs.client}/${fs.stream}`
    if (errors.length > 0) throw new Error(`${label}: ${errors.join("; ")}`)
    const view = viewOfFeed({ ...fs, seen }, log)
    const stream = streamSeqs(log, fs.stream)
    if (!isPrefix(view, stream)) {
      throw new Error(`${label} saw ${view.join(",")} of ${stream.join(",")}`)
    }
    for (const snapshot of snapshots) {
      const at = fold(log, snapshot.seq)
      for (const [s, [state, pending]] of snapshot.sessions) {
        const v = at.get(s)
        if (v === undefined)
          throw new Error(`${label} snapshot at ${snapshot.seq} has unknown ${s}`)
        expect({ label, s, seq: snapshot.seq, state, pending }).toEqual({
          label,
          s,
          seq: snapshot.seq,
          state: v.state,
          pending: [...v.pending].sort(),
        })
      }
    }
    fs.snapshots.splice(0, snapshots.length)
  }
}

const sessionOfCommand = (command: Command): string =>
  "sessionId" in command ? (command.sessionId as string) : ""

// ── fast-check commands ─────────────────────────────────────────────────────

type HarnessWhat = "item" | "delta" | "request" | "withdraw" | "end" | "late"

type Action =
  | {
      readonly tag: "dispatch"
      readonly device: ClientName
      readonly kind:
        | "SendTurn"
        | "Continue"
        | "Respond"
        | "Interrupt"
        | "Rename"
        | "Archive"
        | "Unarchive"
      readonly s: SessionName
      readonly pick: number
      /** Reuse an earlier command (same id, same command, same device): a retry. */
      readonly retry: number | null
    }
  | {
      readonly tag: "harness"
      readonly s: SessionName
      readonly what: HarnessWhat
      readonly pick: number
    }
  /** Both devices answer the same pending request at once. */
  | { readonly tag: "race"; readonly s: SessionName; readonly pick: number }

type Cmd = fc.AsyncCommand<object, World>

abstract class Step implements Cmd {
  check = () => true
  abstract step(world: World): Promise<void>
  async run(_model: object, world: World) {
    await this.step(world)
    await checkInvariants(world)
  }
}

let idCounter = 0

const toDispatch = (world: World, action: Extract<Action, { tag: "dispatch" }>) => {
  if (action.retry !== null && world.sent.length > 0) {
    const earlier = world.sent[action.retry % world.sent.length]!
    return { device: earlier.device, id: earlier.id, command: earlier.command }
  }
  const sessionId = action.s as SessionId
  let command: Command
  switch (action.kind) {
    case "SendTurn":
      command = { _tag: "SendTurn", sessionId, prompt: "go on", attachments: [] }
      break
    case "Continue":
      command = { _tag: "Continue", sessionId }
      break
    case "Interrupt":
      command = { _tag: "Interrupt", sessionId }
      break
    case "Rename":
      command = { _tag: "RenameSession", sessionId, title: `t${idCounter}` }
      break
    case "Archive":
      command = { _tag: "ArchiveSession", sessionId, deleteMergedBranch: false }
      break
    case "Unarchive":
      command = { _tag: "UnarchiveSession", sessionId }
      break
    case "Respond": {
      // A pending request, or sometimes one already closed (a late answer).
      const model = world.model()
      const pending = [...(model.sessions.get(sessionId)?.pending.keys() ?? [])]
      const any = Array.from(
        { length: world.requestCounter },
        (_, i) => `req-${i + 1}` as RequestId,
      )
      const pool = pending.length > 0 && action.pick % 4 !== 0 ? pending : any
      if (pool.length === 0) return null
      const requestId = pool[action.pick % pool.length]!
      command = {
        _tag: "RespondToApproval",
        sessionId: model.sessions.get(sessionId)?.pending.get(requestId)?.sessionId ?? sessionId,
        requestId,
        decision: { _tag: "Allow", remember: false },
      }
      break
    }
  }
  return { device: action.device, id: `cmd-${++idCounter}`, command }
}

class Burst extends Step {
  constructor(
    readonly actions: ReadonlyArray<Action>,
    readonly scheduler: fc.Scheduler,
    readonly crashAfter: number | null,
  ) {
    super()
  }

  override async step(world: World) {
    const runtime = world.rt
    const done: Array<Promise<void>> = []
    const actions = this.actions.flatMap(
      (action): ReadonlyArray<Action> =>
        action.tag === "race"
          ? CLIENTS.map((device) => ({
              tag: "dispatch",
              device,
              kind: "Respond",
              s: action.s,
              pick: action.pick * 4 + 1,
              retry: null,
            }))
          : [action],
    )
    for (const action of actions) {
      done.push(
        this.scheduler.schedule(Promise.resolve(), action.tag).then(() => {
          if (world.runtime !== runtime) return
          if (action.tag === "harness") return world.harness(action.s, action.what, action.pick)
          if (action.tag === "race") return
          const d = toDispatch(world, action)
          if (d === null) return
          return world.dispatch(d.device, d.id, d.command)
        }),
      )
    }
    if (this.crashAfter === null) {
      await this.scheduler.waitIdle()
      await Promise.all(done)
      await sleep(2)
      return
    }
    const upTo = Math.min(this.crashAfter ?? 0, this.scheduler.count())
    if (upTo > 0) await this.scheduler.waitNext(upTo)
    reached.crashesMidBurst++
    await restart(world)
    await this.scheduler.waitIdle()
  }

  override toString() {
    const acts = this.actions
      .map((a) =>
        a.tag === "harness"
          ? `${a.s}.${a.what}`
          : a.tag === "race"
            ? `race(${a.s})`
            : `${a.device}:${a.retry === null ? a.kind : `retry#${a.retry}`}(${a.s})`,
      )
      .join(", ")
    return `Burst(${acts}${this.crashAfter === null ? "" : `; crash after ${this.crashAfter}`})`
  }
}

/** Crash, reopen, and check the recovery rule before anything else happens. */
const restart = async (world: World) => {
  reached.crashes++
  const before = world.model()
  await world.crash()
  await world.open()
  const after = world.model()
  world.restarts.push(after.sequence)
  expect(world.driver.sessions).toHaveLength(0) // nothing continued on its own
  for (const [id, record] of after.sessions) {
    expect(record.turns.filter((t) => t.status === "working")).toEqual([])
    expect(record.pending.size).toBe(0)
    const was = before.sessions.get(id)
    const wasWorking = was?.turns.find((t) => t.status === "working")
    if (wasWorking !== undefined) {
      reached.interruptedByRestart++
      expect(record.turns.find((t) => t.id === wasWorking.id)?.status).toBe("interrupted")
      expect(record.session.state).toBe("needs-you")
    }
  }
}

class Crash extends Step {
  override async step(world: World) {
    await restart(world)
  }
  override toString() {
    return "Crash"
  }
}

class Disconnect extends Step {
  constructor(readonly device: ClientName) {
    super()
  }
  override async step(world: World) {
    world.disconnect(this.device)
    await sleep(2)
  }
  override toString() {
    return `Disconnect(${this.device})`
  }
}

class Stall extends Step {
  constructor(
    readonly index: number,
    readonly stalled: boolean,
  ) {
    super()
  }
  override async step(world: World) {
    const fs = world.feeds[this.index % world.feeds.length]!
    if (this.stalled) Latch.closeUnsafe(fs.gate)
    else Latch.openUnsafe(fs.gate)
  }
  override toString() {
    return `${this.stalled ? "Stall" : "Unstall"}(feed ${this.index})`
  }
}

// ── Arbitraries ─────────────────────────────────────────────────────────────

const sessionArb = fc.constantFrom<SessionName>(...SESSIONS)
const actionArb: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      tag: fc.constant("dispatch" as const),
      device: fc.constantFrom<ClientName>(...CLIENTS),
      kind:
        TRACE_DIR === undefined
          ? fc.constantFrom(
              "SendTurn",
              "Continue",
              "Respond",
              "Respond",
              "Interrupt",
              "Rename",
              "Archive",
              "Unarchive",
            )
          : fc.constantFrom(
              "SendTurn",
              "Continue",
              "Respond",
              "Respond",
              "Rename",
              "Archive",
              "Unarchive",
            ),
      s: sessionArb,
      pick: fc.nat(40),
      retry: fc.option(fc.nat(40), { freq: 4 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      tag: fc.constant("harness" as const),
      s: sessionArb,
      what: fc.constantFrom<HarnessWhat>(
        "item",
        "delta",
        "request",
        "request",
        "withdraw",
        "end",
        "late",
      ),
      pick: fc.nat(40),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ tag: fc.constant("race" as const), s: sessionArb, pick: fc.nat(40) }),
  },
)

const burstArb = fc
  .tuple(fc.array(actionArb, { minLength: 1, maxLength: 6 }), fc.scheduler())
  .map(([actions, s]) => new Burst(actions, s, null))

// fc.commands picks among these uniformly: bursts are listed several times to weigh them.
const commandArbs: Array<fc.Arbitrary<Cmd>> = [
  burstArb,
  burstArb,
  burstArb,
  burstArb,
  fc
    .tuple(fc.array(actionArb, { minLength: 1, maxLength: 5 }), fc.scheduler(), fc.nat(4))
    .map(([actions, s, n]) => new Burst(actions, s, n)),
  fc.constant(new Crash()),
  fc.constantFrom<ClientName>(...CLIENTS).map((d) => new Disconnect(d)),
  fc.tuple(fc.nat(5), fc.boolean()).map(([i, stalled]) => new Stall(i, stalled)),
]

/** Count what a finished run reached, for POLARIS_PBT_STATS. */
const tally = (world: World, log: ReadonlyArray<AEvent>) => {
  for (const e of log) {
    if (e.tag === "ApprovalResolved") reached.approvalsResolved++
    if (e.what.endsWith(":harness")) reached.withdrawnByHarness++
    if (e.what.endsWith(":daemon")) reached.withdrawnByDaemon++
    if (e.what === "state:archived") reached.archived++
    if (e.what === "state:dormant" && e.commandId !== null) reached.unarchived++
  }
  const ids = new Map<string, number>()
  for (const sent of world.sent) ids.set(sent.id, (ids.get(sent.id) ?? 0) + 1)
  reached.retries += [...ids.values()].filter((n) => n > 1).length
  const answers = new Map<string, Set<string>>()
  for (const sent of world.sent) {
    if (sent.command._tag !== "RespondToApproval" || sent.answer === null) continue
    const kinds = answers.get(sent.command.requestId) ?? new Set()
    kinds.add(sent.answer.startsWith("seq:") ? `ok:${sent.id}` : "rejected")
    answers.set(sent.command.requestId, kinds)
  }
  for (const kinds of answers.values())
    if (kinds.has("rejected") && kinds.size > 1) reached.answerRaces++
}

// ── The property ────────────────────────────────────────────────────────────

const RUNS = pbtRuns(12)
let traceCounter = 0

/**
 * With POLARIS_TRACE_DIR set, each run writes its committed log, the commands
 * sent and the restart points as JSON, for `packages/spec/scripts/replay.ts`
 * to replay against the spec (trace validation).
 */
const writeTrace = (world: World, log: ReadonlyArray<AEvent>) => {
  if (TRACE_DIR === undefined) return
  mkdirSync(TRACE_DIR, { recursive: true })
  const sent = new Map<string, { device: string; command: Command }>()
  for (const s of world.sent)
    if (!sent.has(s.id)) sent.set(s.id, { device: s.device, command: s.command })
  writeFileSync(
    join(TRACE_DIR, `engine-${process.pid}-${++traceCounter}.json`),
    JSON.stringify({ log, commands: Object.fromEntries(sent), restarts: world.restarts }, null, 1),
  )
}

const setUp = async (world: World) => {
  await world.open()
  const engine = world.rt.runSync(Effect.map(Engine, (e) => e))
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
  const repo = fakeRepo()
  await run(
    engine.dispatch({
      commandId: CommandId.make(`setup-ws-${++idCounter}`),
      command: { _tag: "RegisterWorkspace", path: repo, name: null },
      deviceLabel: "setup",
    }),
  )
  const workspace = [...world.model().workspaces.values()][0]!
  for (const s of SESSIONS) {
    await run(
      engine.dispatch({
        commandId: CommandId.make(`setup-${s}-${++idCounter}`),
        command: {
          _tag: "StartSession",
          sessionId: s as SessionId,
          workspaceId: workspace.id,
          harness: "codex",
          placement: { _tag: "InPlace" },
          permissionMode: "supervised",
          model: null,
          prompt: "start",
          attachments: [],
        },
        deviceLabel: "setup",
      }),
    )
  }
  await eventually("the sessions' Harnesses open", () =>
    SESSIONS.every((s) => world.driver.latest(s as SessionId) !== undefined),
  )
  await world.startFeeds()
}

describe("Engine, model-based", () => {
  test(
    "commands, approvals, restarts and Client feeds match the reference model",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 6 }),
          fc.commands(commandArbs, { maxCommands: 30, size: "+1" }),
          async (capacity, commands) => {
            const world = new World(capacity)
            try {
              await setUp(world)
              await fc.asyncModelRun(() => ({ model: {}, real: world }), commands)
              // Liveness: with every Client reading again and the Daemon up, each feed
              // catches up with its whole stream.
              for (const fs of world.feeds) Latch.openUnsafe(fs.gate)
              const behind = async () => {
                const log = await world.readLog()
                return world.feeds
                  .filter((fs) => !isPrefix(streamSeqs(log, fs.stream), viewOfFeed(fs, log)))
                  .map(
                    (fs) =>
                      `${fs.client}/${fs.stream} at ${viewOfFeed(fs, log).at(-1)} of ` +
                      `${streamSeqs(log, fs.stream).at(-1)} (${fs.errors.join("; ")}) ${JSON.stringify(fs.seen)}`,
                  )
              }
              const deadline = Date.now() + 5000
              while ((await behind()).length > 0) {
                if (Date.now() > deadline) {
                  throw new Error(`feeds did not catch up: ${(await behind()).join(", ")}`)
                }
                await sleep(5)
              }
              await checkInvariants(world)
              const log = await world.readLog()
              tally(world, log)
              writeTrace(world, log)
            } finally {
              await world.dispose()
            }
          },
        ),
        { numRuns: RUNS, ...pbtSeed() },
      )
      if (process.env.POLARIS_PBT_STATS === "1") console.info("Engine PBT reached", reached)
    },
    pbtTimeout(RUNS, 3000),
  )
})

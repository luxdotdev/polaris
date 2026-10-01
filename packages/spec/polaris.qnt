// -*- mode: Bluespec; -*-
/**
 * Polaris: the event store, its live subscribers, Client feeds and approvals.
 *
 * An abstract model of how commands become committed events and how every
 * Client comes to see exactly the committed sequence, across group commits,
 * retries, slow subscribers, reconnects and Daemon crashes. See README.md for
 * how each variable and action maps to the code and what is left out.
 *
 * Instances at the end of the file:
 *   - `current`:  the code as it is.
 *   - `finding1`, `finding2`, `finding3`: the code before each ENG-209 fix; each
 *     must violate `safety` (`scripts/check.ts` checks that it still does).
 *   - `small`:    a smaller `current`, for Apalache.
 */
module polaris {
  // ── Parameters ────────────────────────────────────────────────────────────

  /**
   * Finding 1: `HostConnection` opened its host feed with `gapless: true`
   * (resume.ts), so a sequence gap made the feed reopen from its last sequence.
   */
  const HOST_FEED_GAPLESS: bool
  /**
   * Finding 2: Archive was refused with a Turn in flight only in the live
   * states, so Starting (which the spec counts as Working) and In Terminal
   * archived with the Turn still working and its approvals pending.
   */
  const ARCHIVE_IGNORES_TURN: bool
  /** Finding 3: the engine recorded an approval request whatever the state of its Turn. */
  const RECORDS_LATE_REQUESTS: bool
  /** Finding 4: Continue reopened an Interrupted Turn the user had already accepted. */
  const CONTINUES_ACCEPTED: bool
  /** Clients also accept Turns and record Verdicts (the `review` and `finding4` instances). */
  const REVIEW_COMMANDS: bool
  /** Client devices, each with a feed per stream. */
  const CLIENTS: Set[str]
  /** Agent Sessions; recovery visits them in this order (any order gives the same result). */
  const SESSION_LIST: List[str]
  /** Command ids the Clients may use. */
  const CMD_IDS: Set[str]
  /** Approval requests a Harness may open, and their session. Each id is used once. */
  const REQUESTS: Set[str]
  const REQUEST_SESSION: str -> str
  /** `StoreConfig.subscriberCapacity`. */
  const CAPACITY: int
  /** Bounds that keep the state space finite: Clients and Harnesses stop adding events at MAX_LOG. */
  const MAX_LOG: int
  const MAX_CRASHES: int

  pure val SESSIONS: Set[str] = SESSION_LIST.foldl(Set(), (acc, s) => acc.union(Set(s)))
  pure val HOST = "host"
  pure val STREAMS: Set[str] = SESSIONS.union(Set(HOST))
  /** Bounds that keep the state space finite. */
  pure val MAX_QUEUE = 3
  pure val NONE = -1

  // ── Types ─────────────────────────────────────────────────────────────────

  type EventKind =
    | TurnStarted(bool) // true: a Continue of an Interrupted Turn
    | TurnEnded(str) // "completed" | "interrupted" | "failed"
    | ItemCompleted // session-only: the host stream leaves it out
    | StateChanged(str) // "working" | "needs-you" | "idle" | "dormant" | "failed" | "archived"
    | ApprovalRequested(str)
    | ApprovalResolved({ req: str, by: str })
    | ApprovalWithdrawn({ req: str, by: str }) // by "harness" | "daemon"
    | TurnsAccepted(int) // accepted through this Turn number
    | ReviewRecorded // a Verdict or Risk Summary event: no session, and off the host stream

  /** A committed event. `cmd` is the command id, "" for events the Daemon records on its own. */
  type Event = { seq: int, session: str, cmd: str, kind: EventKind }

  type Command =
    | SendTurn(str)
    | Continue(str)
    | Retry(str)
    | Respond({ session: str, req: str })
    | Archive(str)
    | Unarchive(str)
    | AcceptTurns({ session: str, through: int })
    | RecordVerdict

  type HarnessEvent =
    | HRequest(str)
    | HWithdraw(str)
    | HItem
    | HTurnEnded
    | HTurnFailed

  /**
   * Something waiting for the next group commit. A Harness report carries the
   * Turn it is about (the session's `turns` when the Harness reported it),
   * as the code's reports carry a `turnId`.
   */
  type Work =
    | ClientCmd({ id: str, client: str, cmd: Command })
    | HarnessEv({ session: str, ev: HarnessEvent, turn: int })

  /** `command_receipts`: the last sequence written (0: accepted, nothing written), or a rejection. */
  type Receipt = NoReceipt | Applied(int) | Refused

  /** What the Client hears back from `dispatch`. */
  type Outcome = Ok(int) | Dup(int) | Rejected

  type Settlement = { id: str, outcome: Outcome }

  /** What a stream sends, in order: a Snapshot or a replay, `Synchronized`, then live events. */
  type Item = Snap(int) | Ev(int) | Sync(int)

  type FeedKey = (str, str) // (Client, stream)

  /** The Daemon side of one open stream: the hub subscriber and what is still in flight. */
  type Sub = {
    phase: str, // "closed" | "registered" | "open"
    after: int, // afterSequence it was opened with (NONE: null)
    cut: int,
    pre: List[Item], // snapshot or replay, then Synchronized
    buf: List[int], // the bounded hub queue (sequences)
    dropped: bool, // fell CAPACITY behind: removed from the hub, ends once drained
  }

  /** The Client side (`makeFeed`): survives reconnects and Daemon restarts. */
  type Feed = { last: int, seen: List[int] }

  /**
   * `requested` lists requests in the order they were opened (the order the
   * engine withdraws them in). `turns` counts the Turns started (the latest
   * one's number: a Continue resumes the same Turn, as it keeps its id).
   * `archivedSinceTurn`: archived after the last Turn started or ended.
   * `accepted`: the Turn number accepted through (0: none).
   */
  type SessionView = {
    turn: str,
    state: str,
    pending: Set[str],
    requested: List[str],
    turns: int,
    archivedSinceTurn: bool,
    accepted: int,
  }

  type Decision = Accept(List[EventKind]) | Refuse

  // ── State ─────────────────────────────────────────────────────────────────

  // Durable: the SQLite database.
  var log: List[Event]
  var receipts: str -> Receipt
  // Daemon memory: lost on a crash.
  var up: bool
  var queue: List[Work]
  var toPublish: List[Event]
  var toSettle: List[Settlement]
  var toReact: Set[str]
  var reactor: Set[str]
  var harness: Set[str]
  var subs: FeedKey -> Sub
  // Clients: outlive the Daemon.
  var feeds: FeedKey -> Feed
  var sentBy: str -> str // command id -> the Client that uses it ("" unused)
  var sentCmd: str -> Command
  var answers: str -> List[Outcome]
  // Ghost variables for the properties.
  var lastRestart: int
  var crashes: int

  // ── The read model (model.ts `project`) ───────────────────────────────────

  pure val emptyView: SessionView =
    {
      turn: "none", state: "dormant", pending: Set(), requested: [], turns: 0,
      archivedSinceTurn: false, accepted: 0,
    }

  pure def applyEvent(v: SessionView, e: Event): SessionView =
    match e.kind {
      | TurnStarted(continued) =>
        { ...v, turn: "working", turns: if (continued) v.turns else v.turns + 1, archivedSinceTurn: false }
      | TurnEnded(status) => { ...v, turn: status, archivedSinceTurn: false }
      | ItemCompleted => v
      | StateChanged(state) =>
        { ...v, state: state, archivedSinceTurn: v.archivedSinceTurn or state == "archived" }
      | ApprovalRequested(r) =>
        { ...v, pending: v.pending.union(Set(r)), requested: v.requested.append(r) }
      | ApprovalResolved(x) => { ...v, pending: v.pending.exclude(Set(x.req)) }
      | ApprovalWithdrawn(x) => { ...v, pending: v.pending.exclude(Set(x.req)) }
      | TurnsAccepted(n) => { ...v, accepted: n }
      | ReviewRecorded => v
    }

  pure def viewOf(events: List[Event], s: str): SessionView =
    events.foldl(emptyView, (v, e) => if (e.session == s) applyEvent(v, e) else v)

  pure def inStream(e: Event, st: str): bool =
    if (st == HOST) e.kind != ItemCompleted and e.kind != ReviewRecorded else e.session == st

  pure def streamSeqs(events: List[Event], st: str): List[int] =
    events.foldl([], (acc, e) => if (inStream(e, st)) acc.append(e.seq) else acc)

  /** Turn number `turn` of the session is the Turn in flight. */
  pure def inFlight(v: SessionView, turn: int): bool =
    v.turn == "working" and v.turns == turn

  // ── The decider (engine/session.ts: commands and Harness events) ─────────

  /**
   * `takesTurn`: no Turn in flight, Idle, Dormant or Failed,
   * or Needs You with nothing pending (after a restart).
   */
  pure def acceptsTurn(v: SessionView): bool =
    v.turn != "working" and v.state != "working" and v.state != "archived"
      and (v.state != "needs-you" or v.pending.size() == 0)

  /**
   * The last pending request closes: back to Working, only with a Turn in
   * flight (finding 3; before its fix, whatever the Turn).
   */
  pure def backToWork(v: SessionView, r: str): List[EventKind] =
    if (v.pending == Set(r) and v.state == "needs-you" and (RECORDS_LATE_REQUESTS or v.turn == "working"))
      [StateChanged("working")]
    else []

  pure def decideClient(v: SessionView, cmd: Command, client: str): Decision =
    match cmd {
      | SendTurn(_) =>
        if (acceptsTurn(v)) Accept([TurnStarted(false), StateChanged("working")]) else Refuse
      | Continue(_) =>
        // An accepted Interrupted Turn stays closed (finding 4).
        if (v.turn == "interrupted" and acceptsTurn(v) and (CONTINUES_ACCEPTED or v.accepted < v.turns))
          Accept([TurnStarted(true), StateChanged("working")])
        else Refuse
      | Retry(_) =>
        // A new Turn with the Failed Turn's prompt.
        if (v.turn == "failed" and acceptsTurn(v))
          Accept([TurnStarted(false), StateChanged("working")])
        else Refuse
      | Respond(x) =>
        // First answer wins: a request no longer pending is rejected.
        if (v.pending.contains(x.req))
          Accept([ApprovalResolved({ req: x.req, by: client })].concat(backToWork(v, x.req)))
        else Refuse
      | Archive(_) =>
        // Refused with a Turn in flight, in every state; anything still pending is withdrawn.
        if (v.state == "archived" or (v.turn == "working" and not(ARCHIVE_IGNORES_TURN))) Refuse
        else if (ARCHIVE_IGNORES_TURN) Accept([StateChanged("archived")])
        else Accept(withdrawAll(v, "daemon").concat([StateChanged("archived")]))
      | Unarchive(_) =>
        if (v.state == "archived") Accept([StateChanged("dormant")]) else Refuse
      | AcceptTurns(x) =>
        // A contiguous prefix, only between Turns, never backwards; the same Turn again records nothing.
        if (v.turn == "working" or v.state == "archived" or x.through < 1 or x.through > v.turns
          or x.through < v.accepted) Refuse
        else if (x.through == v.accepted) Accept([])
        else Accept([TurnsAccepted(x.through)])
      | RecordVerdict => Accept([ReviewRecorded])
    }

  pure def withdrawAll(v: SessionView, by: str): List[EventKind] =
    v.requested.foldl([], (l, r) =>
      if (v.pending.contains(r)) l.append(ApprovalWithdrawn({ req: r, by: by })) else l)

  /**
   * A Harness report about Turn `turn`, decided against the session's view:
   * requests and Turn ends count only for the Turn in flight. Archived records a Turn's end without leaving Archived and
   * ignores requests.
   */
  pure def decideHarness(v: SessionView, ev: HarnessEvent, turn: int): List[EventKind] =
    match ev {
      | HRequest(r) =>
        if (v.state == "archived" or not(RECORDS_LATE_REQUESTS or inFlight(v, turn))) []
        else
          [ApprovalRequested(r)].concat(
            if (v.state != "needs-you") [StateChanged("needs-you")] else []
          )
      | HWithdraw(r) =>
        if (v.pending.contains(r))
          [ApprovalWithdrawn({ req: r, by: "harness" })].concat(backToWork(v, r))
        else []
      | HItem => [ItemCompleted]
      | HTurnEnded =>
        if (inFlight(v, turn))
          withdrawAll(v, "harness").concat([TurnEnded("completed")]).concat(
            if (v.state == "archived") [] else [StateChanged("idle")]
          )
        else []
      | HTurnFailed =>
        if (inFlight(v, turn))
          withdrawAll(v, "harness").concat([TurnEnded("failed")]).concat(
            if (v.state == "archived") [] else [StateChanged("failed")]
          )
        else []
    }

  pure def sessionOfCmd(cmd: Command): str =
    match cmd {
      | SendTurn(s) => s
      | Continue(s) => s
      | Retry(s) => s
      | Respond(x) => x.session
      | Archive(s) => s
      | Unarchive(s) => s
      | AcceptTurns(x) => x.session
      | RecordVerdict => ""
    }

  /** Commands whose reactor then runs: a Turn opens the Harness, Archive stops it. */
  pure def reacts(cmd: Command): bool =
    match cmd {
      | SendTurn(_) => true
      | Continue(_) => true
      | Retry(_) => true
      | Respond(_) => false
      | Archive(_) => true
      | Unarchive(_) => false
      | AcceptTurns(_) => false
      | RecordVerdict => false
    }

  /** Append `kinds` to `events` with the next sequences (gapless by construction). */
  pure def appendEvents(events: List[Event], s: str, cmd: str, kinds: List[EventKind]): List[Event] =
    kinds.foldl(events, (acc, k) =>
      acc.append({ seq: acc.length() + 1, session: s, cmd: cmd, kind: k }))

  /**
   * The recovery rule (session.ts `recover`) for one session. An Archived
   * session stays Archived; one an older log left with a Turn in flight has it
   * Interrupted and its requests withdrawn (unreachable once Archive refuses a
   * Turn in flight, but modelled as the code does it).
   */
  pure def recoverSession(events: List[Event], s: str): List[Event] =
    val v = viewOf(events, s)
    if (v.state == "dormant") events
    else if (v.state == "archived")
      appendEvents(events, s, "",
        (if (v.turn == "working") [TurnEnded("interrupted")] else []).concat(withdrawAll(v, "daemon")))
    else {
      val interrupted = if (v.turn == "working") [TurnEnded("interrupted")] else []
      val closing =
        if (v.turn == "working") [StateChanged("needs-you")]
        else if (v.state == "failed" or (v.state == "needs-you" and v.turn == "interrupted")) []
        else [StateChanged("dormant")]
      appendEvents(events, s, "", interrupted.concat(withdrawAll(v, "daemon")).concat(closing))
    }

  // ── One group commit (EventStore.ts `runBatch`) ───────────────────────────

  type BatchAcc = {
    events: List[Event],
    receipts: str -> Receipt,
    settle: List[Settlement],
    react: Set[str],
  }

  pure def decideOne(acc: BatchAcc, w: Work): BatchAcc =
    match w {
      | ClientCmd(c) =>
        match acc.receipts.get(c.id) {
          | Applied(n) => { ...acc, settle: acc.settle.append({ id: c.id, outcome: Dup(n) }) }
          | Refused => { ...acc, settle: acc.settle.append({ id: c.id, outcome: Rejected }) }
          | NoReceipt =>
            val s = sessionOfCmd(c.cmd)
            match decideClient(viewOf(acc.events, s), c.cmd, c.client) {
              | Refuse => {
                ...acc,
                receipts: acc.receipts.set(c.id, Refused),
                settle: acc.settle.append({ id: c.id, outcome: Rejected }),
              }
              | Accept(kinds) =>
                val events = appendEvents(acc.events, s, c.id, kinds)
                // A command that records nothing is acknowledged with no sequence (0).
                val written = if (kinds.length() == 0) 0 else events.length()
                {
                  events: events,
                  receipts: acc.receipts.set(c.id, Applied(written)),
                  settle: acc.settle.append({ id: c.id, outcome: Ok(written) }),
                  react: if (reacts(c.cmd)) acc.react.union(Set(s)) else acc.react,
                }
            }
        }
      | HarnessEv(h) =>
        val kinds = decideHarness(viewOf(acc.events, h.session), h.ev, h.turn)
        { ...acc, events: appendEvents(acc.events, h.session, "", kinds) }
    }

  // ── Client feeds (resume.ts `handle`) ─────────────────────────────────────

  pure def gapless(st: str): bool = HOST_FEED_GAPLESS and st == HOST

  type Handled = { feed: Feed, reopen: bool }

  pure def handle(f: Feed, it: Item, st: str, events: List[Event]): Handled =
    match it {
      | Snap(cut) =>
        { feed: { last: cut, seen: streamSeqs(events, st).select(x => x <= cut) }, reopen: false }
      | Sync(_) => { feed: f, reopen: false }
      | Ev(seq) =>
        if (f.last != NONE and seq <= f.last) { feed: f, reopen: false }
        else if (gapless(st) and f.last != NONE and seq != f.last + 1) { feed: f, reopen: true }
        else { feed: { last: seq, seen: f.seen.append(seq) }, reopen: false }
    }

  // ── Initial state ─────────────────────────────────────────────────────────

  pure val FEED_KEYS: Set[FeedKey] = tuples(CLIENTS, STREAMS)
  pure val closedSub: Sub =
    { phase: "closed", after: NONE, cut: 0, pre: [], buf: [], dropped: false }

  action init = all {
    log' = [],
    receipts' = CMD_IDS.mapBy(_ => NoReceipt),
    up' = true,
    queue' = [],
    toPublish' = [],
    toSettle' = [],
    toReact' = Set(),
    reactor' = Set(),
    harness' = Set(),
    subs' = FEED_KEYS.mapBy(_ => closedSub),
    feeds' = FEED_KEYS.mapBy(_ => { last: NONE, seen: [] }),
    sentBy' = CMD_IDS.mapBy(_ => ""),
    sentCmd' = CMD_IDS.mapBy(_ => SendTurn(SESSION_LIST[0])),
    answers' = CMD_IDS.mapBy(_ => []),
    lastRestart' = 0,
    crashes' = 0,
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  action unchangedClients = all {
    feeds' = feeds, sentBy' = sentBy, sentCmd' = sentCmd, answers' = answers,
  }
  action unchangedGhosts = all { lastRestart' = lastRestart, crashes' = crashes }

  /** A Client sends a command under a fresh id (`dispatch`). */
  action clientSends(c: str, id: str, cmd: Command): bool = all {
    up,
    sentBy.get(id) == "",
    queue.length() < MAX_QUEUE,
    log.length() < MAX_LOG,
    queue' = queue.append(ClientCmd({ id: id, client: c, cmd: cmd })),
    sentBy' = sentBy.set(id, c),
    sentCmd' = sentCmd.set(id, cmd),
    feeds' = feeds, answers' = answers,
    log' = log, receipts' = receipts, up' = up, toPublish' = toPublish, toSettle' = toSettle,
    toReact' = toReact, reactor' = reactor, harness' = harness, subs' = subs,
    unchangedGhosts,
  }

  /** The same command again under the same id: a retry after a lost answer, or a duplicate. */
  action clientRetries(id: str): bool = all {
    up,
    sentBy.get(id) != "",
    queue.length() < MAX_QUEUE,
    queue' = queue.append(ClientCmd({ id: id, client: sentBy.get(id), cmd: sentCmd.get(id) })),
    unchangedClients,
    log' = log, receipts' = receipts, up' = up, toPublish' = toPublish, toSettle' = toSettle,
    toReact' = toReact, reactor' = reactor, harness' = harness, subs' = subs,
    unchangedGhosts,
  }

  pure def queuedRequest(q: List[Work], r: str): bool =
    q.indices().exists(i => match q[i] {
      | HarnessEv(h) => h.ev == HRequest(r)
      | _ => false
    })

  /**
   * The Harness of a live session reports something about its latest Turn; the
   * engine records it with `recordFor`. Items, withdrawals and Turn ends come
   * while that Turn is in flight. An approval request may also come late,
   * after the Turn ended (a stale or misbehaving Harness), and any report may
   * be decided after a later decision ended its Turn or started another.
   */
  action harnessReports(s: str, ev: HarnessEvent): bool = all {
    up,
    harness.contains(s),
    queue.length() < MAX_QUEUE,
    log.length() < MAX_LOG,
    val v = viewOf(log, s)
    match ev {
      | HRequest(r) => all {
        v.turns > 0,
        REQUEST_SESSION.get(r) == s,
        not(v.requested.indices().exists(i => v.requested[i] == r)),
        not(queuedRequest(queue, r)),
      }
      | HWithdraw(r) => v.pending.contains(r)
      | HItem => v.turn == "working"
      | HTurnEnded => v.turn == "working"
      | HTurnFailed => v.turn == "working"
    },
    queue' = queue.append(HarnessEv({ session: s, ev: ev, turn: viewOf(log, s).turns })),
    unchangedClients,
    log' = log, receipts' = receipts, up' = up, toPublish' = toPublish, toSettle' = toSettle,
    toReact' = toReact, reactor' = reactor, harness' = harness, subs' = subs,
    unchangedGhosts,
  }

  /**
   * The drain takes everything queued as one batch, decides each against the
   * model the ones before it produced, and writes it all in one transaction.
   * Subscribers and callers hear of it only in `publishBatch`.
   */
  action commitBatch = all {
    up,
    queue.length() > 0,
    toPublish.length() == 0,
    toSettle.length() == 0,
    val result = queue.foldl(
      { events: log, receipts: receipts, settle: [], react: Set() },
      (acc, w) => decideOne(acc, w)
    )
    all {
      log' = result.events,
      receipts' = result.receipts,
      toPublish' = result.events.slice(log.length(), result.events.length()),
      toSettle' = result.settle,
      toReact' = result.react,
    },
    queue' = [],
    unchangedClients,
    up' = up, reactor' = reactor, harness' = harness, subs' = subs,
    unchangedGhosts,
  }

  pure def offer(sub: Sub, events: List[Event], st: str): Sub =
    events.foldl(sub, (acc, e) =>
      if (acc.phase == "closed" or acc.dropped or not(inStream(e, st))) acc
      else if (acc.buf.length() < CAPACITY) { ...acc, buf: acc.buf.append(e.seq) }
      else { ...acc, dropped: true })

  /** After the transaction: publish to the live hub, settle every caller (the ack), fork reactors. */
  action publishBatch = all {
    up,
    toPublish.length() > 0 or toSettle.length() > 0 or toReact.size() > 0,
    subs' = FEED_KEYS.mapBy(k => offer(subs.get(k), toPublish, k._2)),
    answers' = toSettle.foldl(answers, (a, st) => a.setBy(st.id, l => l.append(st.outcome))),
    reactor' = reactor.union(toReact),
    toPublish' = [],
    toSettle' = [],
    toReact' = Set(),
    feeds' = feeds, sentBy' = sentBy, sentCmd' = sentCmd,
    log' = log, receipts' = receipts, up' = up, queue' = queue, harness' = harness,
    unchangedGhosts,
  }

  /**
   * The reactor of a SendTurn / Continue / Retry opens the Harness (`runTurn`), if the
   * Turn is still in flight; Archive's stops it (`stopHarness`).
   */
  action reactorRuns(s: str): bool = all {
    up,
    reactor.contains(s),
    reactor' = reactor.exclude(Set(s)),
    val v = viewOf(log, s)
    harness' =
      if (v.state == "archived") harness.exclude(Set(s))
      else if (v.turn == "working") harness.union(Set(s))
      else harness,
    unchangedClients,
    log' = log, receipts' = receipts, up' = up, queue' = queue, toPublish' = toPublish,
    toSettle' = toSettle, toReact' = toReact, subs' = subs,
    unchangedGhosts,
  }

  /** A feed opens its stream: `store.subscribe` first (the hub subscriber)… */
  action subscribe(c: str, st: str): bool = all {
    up,
    subs.get((c, st)).phase == "closed",
    subs' = subs.set((c, st), { ...closedSub, phase: "registered", after: feeds.get((c, st)).last }),
    unchangedClients,
    log' = log, receipts' = receipts, up' = up, queue' = queue, toPublish' = toPublish,
    toSettle' = toSettle, toReact' = toReact, reactor' = reactor, harness' = harness,
    unchangedGhosts,
  }

  /** …then the model's sequence as the cut, and a snapshot or a replay of `(after, cut]`. */
  action readCut(c: str, st: str): bool = all {
    up,
    val sub = subs.get((c, st))
    val cut = log.length()
    val replay =
      if (sub.after == NONE or sub.after > cut) [Snap(cut)]
      else streamSeqs(log, st).select(x => x > sub.after and x <= cut).foldl([], (l, x) => l.append(Ev(x)))
    all {
      sub.phase == "registered",
      subs' = subs.set((c, st), { ...sub, phase: "open", cut: cut, pre: replay.append(Sync(cut)) }),
    },
    unchangedClients,
    log' = log, receipts' = receipts, up' = up, queue' = queue, toPublish' = toPublish,
    toSettle' = toSettle, toReact' = toReact, reactor' = reactor, harness' = harness,
    unchangedGhosts,
  }

  /** The Client receives the next item of an open stream; live events at or below the cut are skipped. */
  action deliver(c: str, st: str): bool = all {
    up,
    val k = (c, st)
    val sub = subs.get(k)
    val fromHead = sub.pre.length() > 0
    all {
      sub.phase == "open",
      fromHead or sub.buf.length() > 0,
      if (fromHead) {
        val h = handle(feeds.get(k), sub.pre.head(), st, log)
        all {
          feeds' = feeds.set(k, h.feed),
          subs' = subs.set(k, if (h.reopen) closedSub else { ...sub, pre: sub.pre.tail() }),
        }
      } else {
        val seq = sub.buf.head()
        if (seq > sub.cut) {
          val h = handle(feeds.get(k), Ev(seq), st, log)
          all {
            feeds' = feeds.set(k, h.feed),
            subs' = subs.set(k, if (h.reopen) closedSub else { ...sub, buf: sub.buf.tail() }),
          }
        } else all {
          feeds' = feeds,
          subs' = subs.set(k, { ...sub, buf: sub.buf.tail() }),
        }
      },
    },
    sentBy' = sentBy, sentCmd' = sentCmd, answers' = answers,
    log' = log, receipts' = receipts, up' = up, queue' = queue, toPublish' = toPublish,
    toSettle' = toSettle, toReact' = toReact, reactor' = reactor, harness' = harness,
    unchangedGhosts,
  }

  /** A dropped subscriber's stream ends once drained; the feed reopens it later. */
  action streamEnds(c: str, st: str): bool = all {
    up,
    val sub = subs.get((c, st))
    all { sub.phase == "open", sub.dropped, sub.pre.length() == 0, sub.buf.length() == 0 },
    subs' = subs.set((c, st), closedSub),
    unchangedClients,
    log' = log, receipts' = receipts, up' = up, queue' = queue, toPublish' = toPublish,
    toSettle' = toSettle, toReact' = toReact, reactor' = reactor, harness' = harness,
    unchangedGhosts,
  }

  /** The Daemon dies at any point: memory, Harnesses and connections go; the database stays. */
  action crash = all {
    up,
    crashes < MAX_CRASHES,
    up' = false,
    queue' = [],
    toPublish' = [],
    toSettle' = [],
    toReact' = Set(),
    reactor' = Set(),
    harness' = Set(),
    subs' = FEED_KEYS.mapBy(_ => closedSub),
    crashes' = crashes + 1,
    lastRestart' = lastRestart,
    unchangedClients,
    log' = log, receipts' = receipts,
  }

  /**
   * Start: load the model from the log and apply the recovery rule to each
   * session, in `order`, before serving anything. (The engine visits sessions
   * in the order the read model loads them; the order changes nothing else.)
   */
  action restartIn(order: List[str]): bool = all {
    not(up),
    val recovered = order.foldl(log, (events, s) => recoverSession(events, s))
    all { log' = recovered, lastRestart' = recovered.length() },
    up' = true,
    crashes' = crashes,
    unchangedClients,
    receipts' = receipts, queue' = queue, toPublish' = toPublish, toSettle' = toSettle,
    toReact' = toReact, reactor' = reactor, harness' = harness, subs' = subs,
  }

  action restart = restartIn(SESSION_LIST)

  pure val COMMANDS: Set[Command] =
    SESSIONS.map(s => SendTurn(s))
      .union(SESSIONS.map(s => Continue(s)))
      .union(SESSIONS.map(s => Retry(s)))
      .union(REQUESTS.map(r => Respond({ session: REQUEST_SESSION.get(r), req: r })))
      .union(SESSIONS.map(s => Archive(s)))
      .union(SESSIONS.map(s => Unarchive(s)))
      .union(if (REVIEW_COMMANDS) REVIEW_COMMAND_SET else Set())

  pure val REVIEW_COMMAND_SET: Set[Command] =
    Set(1, 2).map(n => AcceptTurns({ session: SESSION_LIST[0], through: n })).union(Set(RecordVerdict))

  pure val HARNESS_EVENTS: Set[HarnessEvent] =
    REQUESTS.map(r => HRequest(r)).union(REQUESTS.map(r => HWithdraw(r))).union(Set(HItem, HTurnEnded, HTurnFailed))

  action step = any {
    nondet c = CLIENTS.oneOf()
    nondet id = CMD_IDS.oneOf()
    nondet cmd = COMMANDS.oneOf()
    clientSends(c, id, cmd),
    nondet id = CMD_IDS.oneOf()
    clientRetries(id),
    nondet s = SESSIONS.oneOf()
    nondet ev = HARNESS_EVENTS.oneOf()
    harnessReports(s, ev),
    commitBatch,
    publishBatch,
    nondet s = SESSIONS.oneOf()
    reactorRuns(s),
    nondet c = CLIENTS.oneOf()
    nondet st = STREAMS.oneOf()
    any { subscribe(c, st), readCut(c, st), deliver(c, st), streamEnds(c, st) },
    crash,
    restart,
  }

  // ── Safety properties ─────────────────────────────────────────────────────

  /** The global sequence has no gaps. */
  val gaplessLog: bool = log.indices().forall(i => log[i].seq == i + 1)

  pure def isPrefix(p: List[int], l: List[int]): bool =
    p.length() <= l.length() and p.indices().forall(i => p[i] == l[i])

  /**
   * Every Client's view of every stream is exactly the committed sequence so far:
   * no gaps, no duplicates, no reordering, across drops, reconnects and restarts.
   */
  val feedsAreCommittedPrefixes: bool =
    FEED_KEYS.forall(k => isPrefix(feeds.get(k).seen, streamSeqs(log, k._2)))

  /** Anything a Client heard back is backed by a durable receipt and, if it wrote, by committed events. */
  val answersAreCommitted: bool =
    CMD_IDS.forall(id =>
      answers.get(id).length() == 0 or match receipts.get(id) {
        | NoReceipt => false
        | Refused => answers.get(id).foldl(true, (ok, o) => ok and o == Rejected)
        | Applied(n) =>
          (n == 0 or (n <= log.length() and log[n - 1].cmd == id))
            and answers.get(id).foldl(true, (ok, o) => ok and (o == Ok(n) or o == Dup(n)))
      })

  /** Only the first attempt of a command id is ever decided: at most one `Ok`. */
  val retriesApplyOnce: bool =
    CMD_IDS.forall(id =>
      answers.get(id).foldl(0, (n, o) => match o { | Ok(_) => n + 1 | _ => n }) <= 1
        and log.indices().filter(i =>
          log[i].cmd == id and match log[i].kind {
            | TurnStarted(_) => true
            | ApprovalResolved(_) => true
            | _ => false
          }).size() <= 1)

  /** A command's events are contiguous and all carry its id: one decision, applied once. */
  val commandEventsContiguous: bool =
    CMD_IDS.forall(id => {
      val at = log.indices().filter(i => log[i].cmd == id)
      at.forall(i => at.forall(j => i <= j implies to(i, j).forall(m => log[m].cmd == id)))
    })

  pure def closes(k: EventKind, r: str): bool =
    match k {
      | ApprovalResolved(x) => x.req == r
      | ApprovalWithdrawn(x) => x.req == r
      | _ => false
    }

  /** Each approval request is resolved or withdrawn at most once, and only after it was requested. */
  val approvalsCloseOnce: bool =
    REQUESTS.forall(r => {
      val closed = log.indices().filter(i => closes(log[i].kind, r))
      val opened = log.indices().filter(i => log[i].kind == ApprovalRequested(r))
      closed.size() <= 1 and opened.size() <= 1
        and closed.forall(i => opened.exists(j => j < i))
    })

  /** First answer wins: one Client's answer is accepted, and it is the one recorded. */
  val firstAnswerWins: bool =
    REQUESTS.forall(r => {
      val accepted = CMD_IDS.filter(id =>
        sentBy.get(id) != "" and sentCmd.get(id) == Respond({ session: REQUEST_SESSION.get(r), req: r })
          and answers.get(id).indices().exists(i => match answers.get(id)[i] { | Ok(_) => true | _ => false }))
      accepted.size() <= 1
        and accepted.forall(id => log.indices().exists(i =>
          log[i].kind == ApprovalResolved({ req: r, by: sentBy.get(id) }) and log[i].cmd == id))
    })

  /** After a restart no request from before it is still pending. */
  val restartWithdrawsApprovals: bool =
    SESSIONS.forall(s => viewOf(log, s).pending.forall(r =>
      log.indices().exists(i => i >= lastRestart and log[i].kind == ApprovalRequested(r))))

  /** Only a Client's command starts or continues a Turn; recovery never does. */
  val noAutoContinue: bool =
    log.indices().forall(i => match log[i].kind { | TurnStarted(_) => log[i].cmd != "" | _ => true })
      and harness.forall(s => log.indices().exists(i =>
        i >= lastRestart and log[i].session == s and log[i].cmd != ""
          and match log[i].kind { | TurnStarted(_) => true | _ => false }))

  /**
   * An Interrupted Turn leaves its session Needs You until a Client continues
   * or replaces it, or archives the session.
   */
  val interruptedNeedsYou: bool =
    SESSIONS.forall(s => {
      val v = viewOf(log, s)
      v.turn == "interrupted" implies (v.state == "needs-you" or v.archivedSinceTurn)
    })

  /** An approval is pending only while a Turn is in flight to answer it for (finding 3). */
  val approvalsNeedATurn: bool =
    SESSIONS.forall(s => {
      val v = viewOf(log, s)
      v.pending.size() > 0 implies v.turn == "working"
    })

  /** A session is Working only with a Turn in flight (finding 3). */
  val workingHasATurn: bool =
    SESSIONS.forall(s => {
      val v = viewOf(log, s)
      v.state == "working" implies v.turn == "working"
    })

  /** An Archived session holds no Turn in flight and no pending approval (finding 2). */
  val archivedIsClosed: bool =
    SESSIONS.forall(s => {
      val v = viewOf(log, s)
      v.state == "archived" implies (v.turn != "working" and v.pending.size() == 0)
    })

  /**
   * A host feed can still make progress: the next host-stream event after the
   * last one it saw does not make it reopen (finding 1). When this fails the
   * feed reopens from `last`, the replay has the same gap, and it never advances.
   */
  /**
   * An accepted Turn is never in flight again, and acceptance never passes the
   * Turns that exist (finding 4: Continue reopened an accepted Interrupted Turn).
   */
  val acceptedNeverInFlight: bool =
    SESSIONS.forall(s => {
      val v = viewOf(log, s)
      v.accepted <= v.turns and not(v.turn == "working" and v.accepted == v.turns and v.accepted > 0)
    })

  /** Each session's `TurnsAccepted` events only move forward. */
  val acceptedOnlyForward: bool =
    log.indices().forall(i => log.indices().forall(j =>
      (i < j and log[i].session == log[j].session) implies match log[i].kind {
        | TurnsAccepted(a) => match log[j].kind { | TurnsAccepted(b) => a < b | _ => true }
        | _ => true
      }))

  val hostFeedCanProgress: bool =
    CLIENTS.forall(c => {
      val f = feeds.get((c, HOST))
      val later = streamSeqs(log, HOST).select(x => f.last != NONE and x > f.last)
      later.length() == 0 or not(handle(f, Ev(later[0]), HOST, log).reopen)
    })

  val safety: bool = all {
    gaplessLog,
    feedsAreCommittedPrefixes,
    answersAreCommitted,
    retriesApplyOnce,
    commandEventsContiguous,
    approvalsCloseOnce,
    firstAnswerWins,
    restartWithdrawsApprovals,
    noAutoContinue,
    interruptedNeedsYou,
    approvalsNeedATurn,
    workingHasATurn,
    archivedIsClosed,
    hostFeedCanProgress,
    acceptedNeverInFlight,
    acceptedOnlyForward,
  }

  // ── Witnesses: states the checks must actually reach (`quint run --witnesses`) ──

  val witnessDropped: bool = FEED_KEYS.exists(k => subs.get(k).dropped)
  val witnessResumedAfterDrop: bool =
    FEED_KEYS.exists(k => subs.get(k).phase == "open" and subs.get(k).after != NONE
      and subs.get(k).pre.length() > 1)
  val witnessDuplicateAnswered: bool =
    CMD_IDS.exists(id => answers.get(id).indices().exists(i => match answers.get(id)[i] { | Dup(_) => true | _ => false }))
  val witnessRetryAfterCrash: bool =
    crashes > 0 and CMD_IDS.exists(id => answers.get(id).length() > 0 and receipts.get(id) != NoReceipt
      and log.indices().exists(i => log[i].cmd == id and i < lastRestart))
  val witnessAnswerRace: bool =
    REQUESTS.exists(r => log.indices().exists(i => match log[i].kind { | ApprovalResolved(x) => x.req == r | _ => false })
      and CMD_IDS.exists(id => sentCmd.get(id) == Respond({ session: REQUEST_SESSION.get(r), req: r })
        and sentBy.get(id) != "" and answers.get(id).indices().exists(i => answers.get(id)[i] == Rejected)))
  val witnessHarnessWithdrew: bool =
    log.indices().exists(i => match log[i].kind { | ApprovalWithdrawn(x) => x.by == "harness" | _ => false })
  val witnessRestartWithdrew: bool =
    log.indices().exists(i => match log[i].kind { | ApprovalWithdrawn(x) => x.by == "daemon" | _ => false })
  val witnessContinued: bool = log.indices().exists(i => log[i].kind == TurnStarted(true))
  /** A Turn started right after a Failed one: a Retry. */
  val witnessRetried: bool =
    log.indices().exists(i => i > 0 and log[i].kind == TurnStarted(false) and log[i].cmd != ""
      and viewOf(log.slice(0, i), log[i].session).turn == "failed")
  val witnessBatchOfTwo: bool = toSettle.length() + toPublish.length() > 0 and toSettle.length() >= 2
  val witnessArchived: bool = log.indices().exists(i => log[i].kind == StateChanged("archived"))
  val witnessUnarchived: bool =
    log.indices().exists(i => log[i].kind == StateChanged("dormant") and log[i].cmd != "")
  val witnessArchiveRefused: bool =
    CMD_IDS.exists(id => match sentCmd.get(id) { | Archive(_) => true | _ => false }
      and sentBy.get(id) != "" and answers.get(id).indices().exists(i => answers.get(id)[i] == Rejected))
  /** A request about to be decided for a Turn that is not (or no longer) in flight. */
  val witnessLateRequest: bool =
    queue.indices().exists(i => match queue[i] {
      | HarnessEv(h) => match h.ev {
        | HRequest(_) => not(inFlight(viewOf(log, h.session), h.turn))
        | _ => false
      }
      | _ => false
    })

  val witnessAccepted: bool = log.indices().exists(i => match log[i].kind { | TurnsAccepted(_) => true | _ => false })
  val witnessVerdict: bool = log.indices().exists(i => log[i].kind == ReviewRecorded)
  val witnessAcceptRefused: bool =
    CMD_IDS.exists(id => match sentCmd.get(id) { | AcceptTurns(_) => true | _ => false }
      and sentBy.get(id) != "" and answers.get(id).indices().exists(i => answers.get(id)[i] == Rejected))

  // ── Liveness ──────────────────────────────────────────────────────────────

  val vars = (
    log, receipts, up, queue, toPublish, toSettle, toReact, reactor, harness, subs,
    feeds, sentBy, sentCmd, answers, lastRestart, crashes,
  )

  /** Every feed has seen its stream up to the last committed event. */
  val caughtUp: bool =
    FEED_KEYS.forall(k => feeds.get(k).seen == streamSeqs(log, k._2))

  /**
   * Fairness: the Daemon keeps running once it is down (restart), commits and
   * publishes what is queued, and every Client keeps its streams open and reads
   * them. Clients, Harnesses and crashes may do anything else, finitely often
   * (bounded by MAX_LOG / MAX_CRASHES).
   */
  temporal fairness: bool =
    weakFair(restart, vars)
      and weakFair(commitBatch, vars)
      and weakFair(publishBatch, vars)
      and FEED_KEYS.forall(k => weakFair(subscribe(k._1, k._2), vars))
      and FEED_KEYS.forall(k => weakFair(readCut(k._1, k._2), vars))
      and FEED_KEYS.forall(k => weakFair(deliver(k._1, k._2), vars))
      and FEED_KEYS.forall(k => weakFair(streamEnds(k._1, k._2), vars))

  /** A Client that resumes (after a drop, a reconnect or a restart) eventually catches up. */
  temporal feedsCatchUp: bool = fairness implies eventually(always(caughtUp))
}

/** The code as it is: two devices, two sessions, two requests in one session. */
module current {
  import polaris(
    HOST_FEED_GAPLESS = false,
    ARCHIVE_IGNORES_TURN = false,
    RECORDS_LATE_REQUESTS = false,
    CONTINUES_ACCEPTED = false,
    REVIEW_COMMANDS = false,
    CLIENTS = Set("mac", "phone"),
    SESSION_LIST = ["s1", "s2"],
    CMD_IDS = Set("k1", "k2", "k3", "k4"),
    REQUESTS = Set("r1", "r2"),
    REQUEST_SESSION = Map("r1" -> "s1", "r2" -> "s1"),
    CAPACITY = 2,
    MAX_LOG = 10,
    MAX_CRASHES = 2,
  ).*
}

/** Finding 1: the host feed with the gap check (`gapless: true`). Violates `hostFeedCanProgress`. */
module finding1 {
  import polaris(
    HOST_FEED_GAPLESS = true,
    ARCHIVE_IGNORES_TURN = false,
    RECORDS_LATE_REQUESTS = false,
    CONTINUES_ACCEPTED = false,
    REVIEW_COMMANDS = false,
    CLIENTS = Set("mac", "phone"),
    SESSION_LIST = ["s1", "s2"],
    CMD_IDS = Set("k1", "k2", "k3", "k4"),
    REQUESTS = Set("r1", "r2"),
    REQUEST_SESSION = Map("r1" -> "s1", "r2" -> "s1"),
    CAPACITY = 2,
    MAX_LOG = 10,
    MAX_CRASHES = 2,
  ).*
}

/** Finding 2: Archive accepted with a Turn in flight. Violates `archivedIsClosed`. */
module finding2 {
  import polaris(
    HOST_FEED_GAPLESS = false,
    ARCHIVE_IGNORES_TURN = true,
    RECORDS_LATE_REQUESTS = false,
    CONTINUES_ACCEPTED = false,
    REVIEW_COMMANDS = false,
    CLIENTS = Set("mac", "phone"),
    SESSION_LIST = ["s1", "s2"],
    CMD_IDS = Set("k1", "k2", "k3", "k4"),
    REQUESTS = Set("r1", "r2"),
    REQUEST_SESSION = Map("r1" -> "s1", "r2" -> "s1"),
    CAPACITY = 2,
    MAX_LOG = 10,
    MAX_CRASHES = 2,
  ).*
}

/** Finding 3: late approval requests recorded. Violates `approvalsNeedATurn` (then `workingHasATurn`). */
module finding3 {
  import polaris(
    HOST_FEED_GAPLESS = false,
    ARCHIVE_IGNORES_TURN = false,
    RECORDS_LATE_REQUESTS = true,
    CONTINUES_ACCEPTED = false,
    REVIEW_COMMANDS = false,
    CLIENTS = Set("mac", "phone"),
    SESSION_LIST = ["s1", "s2"],
    CMD_IDS = Set("k1", "k2", "k3", "k4"),
    REQUESTS = Set("r1", "r2"),
    REQUEST_SESSION = Map("r1" -> "s1", "r2" -> "s1"),
    CAPACITY = 2,
    MAX_LOG = 10,
    MAX_CRASHES = 2,
  ).*
}

/**
 * Finding 4: Continue of an accepted Interrupted Turn. Violates
 * `acceptedNeverInFlight`. One session, so the simulator reaches it.
 */
module finding4 {
  import polaris(
    HOST_FEED_GAPLESS = false,
    ARCHIVE_IGNORES_TURN = false,
    RECORDS_LATE_REQUESTS = false,
    CONTINUES_ACCEPTED = true,
    REVIEW_COMMANDS = true,
    CLIENTS = Set("mac", "phone"),
    SESSION_LIST = ["s1"],
    CMD_IDS = Set("k1", "k2", "k3", "k4"),
    REQUESTS = Set("r1"),
    REQUEST_SESSION = Map("r1" -> "s1"),
    CAPACITY = 2,
    MAX_LOG = 10,
    MAX_CRASHES = 2,
  ).*
}

/**
 * The code as it is, with Clients also accepting Turns and recording Verdicts,
 * in one session so accepting is reached often.
 */
module review {
  import polaris(
    HOST_FEED_GAPLESS = false,
    ARCHIVE_IGNORES_TURN = false,
    RECORDS_LATE_REQUESTS = false,
    CONTINUES_ACCEPTED = false,
    REVIEW_COMMANDS = true,
    CLIENTS = Set("mac", "phone"),
    SESSION_LIST = ["s1"],
    CMD_IDS = Set("k1", "k2", "k3", "k4", "k5", "k6"),
    REQUESTS = Set("r1"),
    REQUEST_SESSION = Map("r1" -> "s1"),
    CAPACITY = 2,
    MAX_LOG = 14,
    MAX_CRASHES = 2,
  ).*
}

/** A smaller instance for Apalache (`quint verify`), which unrolls every step symbolically. */
module small {
  import polaris(
    HOST_FEED_GAPLESS = false,
    ARCHIVE_IGNORES_TURN = false,
    RECORDS_LATE_REQUESTS = false,
    CONTINUES_ACCEPTED = false,
    REVIEW_COMMANDS = false,
    CLIENTS = Set("mac", "phone"),
    SESSION_LIST = ["s1"],
    CMD_IDS = Set("k1", "k2"),
    REQUESTS = Set("r1"),
    REQUEST_SESSION = Map("r1" -> "s1"),
    CAPACITY = 1,
    MAX_LOG = 8,
    MAX_CRASHES = 1,
  ).*
}

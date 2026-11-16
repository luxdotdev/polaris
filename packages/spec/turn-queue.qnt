// -*- mode: Bluespec; -*-
/**
 * Queued Turns (ENG-941): in a shared Agent Session a Turn sent while one is in flight joins a
 * first-in-first-out queue, and starts when the Turn in flight ends. Its author or the owner
 * may cancel or edit it. The machine is `apps/daemon/src/engine/session.queue.ts` and
 * `session.ts`; README.md, "Queued Turns", maps the names.
 *
 * People and Turn ids are small integers. The session's other states (Starting, Needs You,
 * In Terminal, Archived) change nothing the queue observes and are folded into `working`
 * or `stopped`.
 */
module turn_queue_model {
  /** The head is taken from the back of the queue. */
  const BUG_LIFO: bool
  /** Anyone holding the `turn` Grant cancels or edits any queued Turn. */
  const BUG_ANYONE_CANCELS: bool
  /** A Turn that fails leaves the queue waiting behind no Turn. */
  const BUG_KEEPS_QUEUE: bool

  /** The owner, on any of their own Clients; 1 and 2 are Teammates with the `turn` Grant. */
  pure val OWNER = 0
  pure val PEOPLE = Set(0, 1, 2)
  /** `QUEUE_LIMIT`, small enough to reach. */
  pure val LIMIT = 3
  pure val MAX_TURNS = 6

  /** `prompt` counts edits: 0 as sent. */
  type Queued = { id: int, by: int, prompt: int }
  type Outcome = Nothing | Started | Queued_ | Refused | Changed
  type View = {
    /** `idle`, `working` (a Turn in flight) or `stopped` (Failed, Dormant, Needs You after a restart). */
    state: str,
    inFlight: int,
    queue: List[Queued],
    /** Every Turn that started, in order, as the Harness got it. */
    ran: List[Queued],
    next: int,
    last: Outcome,
    // Ghosts: every Turn that ever queued, in arrival order; the ones cancelled or dropped,
    // and who cancelled or edited what.
    arrived: List[Queued],
    cancelled: Set[int],
    dropped: Set[int],
    changes: Set[{ id: int, author: int, by: int }],
  }

  type Event =
    | Send({ by: int, shared: bool })
    | Cancel({ id: int, by: int })
    | Edit({ id: int, by: int })
    /** `harness.turnEnded`: `completed`, `interrupted` or `failed`. */
    | End(str)
    /** The Harness exits, the Daemon restarts or the session fails with the Turn in flight. */
    | Lose

  pure val empty: View = {
    state: "idle", inFlight: -1, queue: [], ran: [], next: 0, last: Nothing,
    arrived: [], cancelled: Set(), dropped: Set(), changes: Set(),
  }

  pure def ids(queue: List[Queued]): Set[int] = queue.indices().map(i => queue[i].id)
  pure def mayChange(q: Queued, by: int): bool = BUG_ANYONE_CANCELS or by == OWNER or by == q.by
  pure def entry(v: View, id: int): Queued = v.queue.select(q => q.id == id)[0]

  /** `queuesTurn` and `queueTurn`: shared, a Turn in flight, room in the queue. */
  pure def send(v: View, by: int, shared: bool): View = {
    val turn = { id: v.next, by: by, prompt: 0 }
    if (v.next >= MAX_TURNS) { ...v, last: Refused }
    else if (v.inFlight < 0)
      { ...v, state: "working", inFlight: turn.id, ran: v.ran.append(turn), next: v.next + 1, last: Started }
    else if (shared and v.queue.length() < LIMIT)
      { ...v, queue: v.queue.append(turn), arrived: v.arrived.append(turn), next: v.next + 1, last: Queued_ }
    else { ...v, last: Refused }
  }

  /** `changeQueued`: only a Turn still queued, by its author or the owner. */
  pure def change(v: View, id: int, by: int, cancel: bool): View =
    if (not(ids(v.queue).contains(id)) or not(mayChange(entry(v, id), by))) { ...v, last: Refused }
    else {
      val noted = { ...v, changes: v.changes.union(Set({ id: id, author: entry(v, id).by, by: by })), last: Changed }
      if (cancel) { ...noted, queue: v.queue.select(q => q.id != id), cancelled: v.cancelled.union(Set(id)) }
      else { ...noted, queue: v.queue.foldl([], (acc, q) => acc.append(if (q.id == id) { ...q, prompt: q.prompt + 1 } else q)) }
    }

  pure def drop(v: View, state: str): View =
    { ...v, state: state, inFlight: -1, queue: [], dropped: v.dropped.union(ids(v.queue)), last: Nothing }

  /** `turnEnded`: a Turn that ends cleanly starts the head (`nextQueued`); a failed one drops the queue. */
  pure def end(v: View, status: str): View =
    if (v.inFlight < 0) v
    else if (status == "failed")
      if (BUG_KEEPS_QUEUE) { ...v, state: "stopped", inFlight: -1, last: Nothing } else drop(v, "stopped")
    else if (v.queue.length() == 0) { ...v, state: "idle", inFlight: -1, last: Nothing }
    else {
      val at = if (BUG_LIFO) v.queue.length() - 1 else 0
      val first = v.queue[at]
      { ...v, state: "working", inFlight: first.id, ran: v.ran.append(first),
        queue: v.queue.select(q => q.id != first.id), last: Started }
    }

  pure def apply(v: View, e: Event): View = match e {
    | Send(p) => send(v, p.by, p.shared)
    | Cancel(p) => change(v, p.id, p.by, true)
    | Edit(p) => change(v, p.id, p.by, false)
    | End(status) => end(v, status)
    | Lose => if (v.inFlight < 0) v else drop(v, "stopped")
  }

  var view: View
  action init = view' = empty
  action publish(e: Event): bool = view' = apply(view, e)
  action step = {
    nondet by = PEOPLE.oneOf()
    nondet shared = Set(true, false).oneOf()
    nondet id = 0.to(MAX_TURNS - 1).oneOf()
    nondet status = Set("completed", "interrupted", "failed").oneOf()
    nondet e = Set(Send({ by: by, shared: shared }), Cancel({ id: id, by: by }), Edit({ id: id, by: by }), End(status), Lose).oneOf()
    publish(e)
  }

  /** The queued Turns that were neither cancelled nor dropped, in arrival order, as they stand now. */
  val kept = view.arrived.select(q => not(view.cancelled.contains(q.id)) and not(view.dropped.contains(q.id)))
  val ranFromQueue = view.ran.select(q => ids(view.arrived).contains(q.id))
  val served = ranFromQueue.concat(view.queue)

  /** A queued Turn waits behind a Turn in flight, never behind nothing. */
  val queueNeedsATurn = view.queue.length() > 0 implies (view.inFlight >= 0 and view.state == "working")
  /** First in, first out, whoever sent it: started and waiting Turns keep their arrival order. */
  val fifo = served.length() == kept.length() and served.indices().forall(i => served[i].id == kept[i].id)
  /** Each Turn runs for the person who sent it, edits included. */
  val authorsKept = served.indices().forall(i => served[i].by == kept[i].by)
  /** A cancelled or dropped Turn never reaches the Harness. */
  val cancelledNeverRun = ids(view.ran).intersect(view.cancelled.union(view.dropped)) == Set()
  /** Only its author or the owner cancels or edits a queued Turn. */
  val authorOrOwnerChanges = view.changes.forall(c => c.by == OWNER or c.by == c.author)
  val bounded = view.queue.length() <= LIMIT
  val inFlightRan = view.inFlight >= 0 implies (view.ran.length() > 0 and view.ran[view.ran.length() - 1].id == view.inFlight)

  val safety = all {
    queueNeedsATurn, fifo, authorsKept, cancelledNeverRun, authorOrOwnerChanges, bounded, inFlightRan,
  }

  // States the simulation must reach, or `safety` proves little.
  val witnessTwoAuthorsRan = Set(1, 2).subseteq(ranFromQueue.indices().map(i => ranFromQueue[i].by))
  val witnessCancelledByOwner = view.changes.exists(c => c.by == OWNER and c.author != OWNER)
  val witnessCancelRefused = view.last == Refused and view.queue.length() > 0
  val witnessDropped = view.dropped != Set()
  val witnessFull = view.queue.length() == LIMIT
}

module turn_queue {
  import turn_queue_model(BUG_LIFO=false, BUG_ANYONE_CANCELS=false, BUG_KEEPS_QUEUE=false).*

  run twoPeoplesTurnsRunInOrderTest = init
    .then(publish(Send({ by: OWNER, shared: true }))).expect(view.last == Started)
    .then(publish(Send({ by: 1, shared: true }))).expect(view.last == Queued_)
    .then(publish(Send({ by: 2, shared: true })))
    .then(publish(Send({ by: OWNER, shared: true })))
    .expect(view.queue.length() == 3 and view.inFlight == 0)
    .then(publish(End("completed"))).expect(view.inFlight == 1 and view.state == "working")
    .then(publish(End("interrupted"))).expect(view.inFlight == 2)
    .then(publish(End("completed"))).expect(view.inFlight == 3)
    .then(publish(End("completed")))
    .expect(view.state == "idle" and view.ran == [
      { id: 0, by: OWNER, prompt: 0 }, { id: 1, by: 1, prompt: 0 },
      { id: 2, by: 2, prompt: 0 }, { id: 3, by: OWNER, prompt: 0 },
    ] and safety)

  run unsharedSessionRefusesTest = init
    .then(publish(Send({ by: OWNER, shared: false })))
    .then(publish(Send({ by: OWNER, shared: false })))
    .expect(view.last == Refused and view.queue == [] and safety)

  run authorOrOwnerCancelsTest = init
    .then(publish(Send({ by: OWNER, shared: true })))
    .then(publish(Send({ by: 1, shared: true })))
    .then(publish(Send({ by: 2, shared: true })))
    .then(publish(Cancel({ id: 1, by: 2 }))).expect(view.last == Refused and view.queue.length() == 2)
    .then(publish(Edit({ id: 1, by: 2 }))).expect(view.last == Refused and view.queue[0].prompt == 0)
    .then(publish(Edit({ id: 1, by: 1 }))).expect(view.last == Changed and view.queue[0] == { id: 1, by: 1, prompt: 1 })
    .then(publish(Cancel({ id: 2, by: OWNER }))).expect(view.last == Changed)
    .then(publish(Cancel({ id: 2, by: 2 }))).expect(view.last == Refused)
    .then(publish(End("completed"))).expect(view.inFlight == 1)
    .then(publish(Cancel({ id: 1, by: 1 }))).expect(view.last == Refused)
    .then(publish(End("completed")))
    .expect(view.state == "idle" and ids(view.ran) == Set(0, 1) and view.ran[1].prompt == 1 and safety)

  run failureAndLossDropTheQueueTest = init
    .then(publish(Send({ by: OWNER, shared: true })))
    .then(publish(Send({ by: 1, shared: true })))
    .then(publish(End("failed")))
    .expect(view.state == "stopped" and view.queue == [] and view.dropped == Set(1) and safety)
    .then(publish(Send({ by: 2, shared: true }))).expect(view.last == Started and view.inFlight == 2)
    .then(publish(Send({ by: 1, shared: true })))
    .then(publish(Lose))
    .expect(view.queue == [] and view.dropped == Set(1, 3) and ids(view.ran) == Set(0, 2) and safety)

  run fullQueueRefusesTest = init
    .then(publish(Send({ by: OWNER, shared: true })))
    .then(publish(Send({ by: 1, shared: true })))
    .then(publish(Send({ by: 1, shared: true })))
    .then(publish(Send({ by: 2, shared: true })))
    .then(publish(Send({ by: 2, shared: true })))
    .expect(view.last == Refused and view.queue.length() == LIMIT and safety)
}

/** The head taken from the back: a later Turn overtakes an earlier one. */
module turn_queue_lifo_mutant {
  import turn_queue_model(BUG_LIFO=true, BUG_ANYONE_CANCELS=false, BUG_KEEPS_QUEUE=false).*

  run overtakesTest = init
    .then(publish(Send({ by: 0, shared: true })))
    .then(publish(Send({ by: 1, shared: true })))
    .then(publish(Send({ by: 2, shared: true })))
    .then(publish(End("completed"))).expect(view.inFlight == 2 and not(safety))
}

/** No author check: one Teammate cancels another's queued Turn. */
module turn_queue_cancel_mutant {
  import turn_queue_model(BUG_LIFO=false, BUG_ANYONE_CANCELS=true, BUG_KEEPS_QUEUE=false).*

  run cancelsAnothersTest = init
    .then(publish(Send({ by: 0, shared: true })))
    .then(publish(Send({ by: 1, shared: true })))
    .then(publish(Cancel({ id: 1, by: 2 }))).expect(view.last == Changed and not(safety))
}

/** A failed Turn keeps the queue: Turns wait behind nothing. */
module turn_queue_keeps_mutant {
  import turn_queue_model(BUG_LIFO=false, BUG_ANYONE_CANCELS=false, BUG_KEEPS_QUEUE=true).*

  run waitsBehindNothingTest = init
    .then(publish(Send({ by: 0, shared: true })))
    .then(publish(Send({ by: 1, shared: true })))
    .then(publish(End("failed"))).expect(view.queue.length() == 1 and not(safety))
}

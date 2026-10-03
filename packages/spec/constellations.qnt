module constellations {
  const TASKS: Set[int]
  const SESSIONS: Set[int]
  const IDS: Set[int]
  const OWNER: str
  const CAPACITY: int

  type Task = { declared: bool, deps: Set[int], parent: int, gate: bool, canceled: bool, revision: int }
  type Attempt = { task: int, session: int, status: str, ref: int, revision: int, sha: int, rejectionReason: str, mergeBase: str }
  type Delivery = { id: int, lead: int }
  type Recovery = { attempt: int, interruption: int }
  type EventKind =
    | TaskDeclared({ task: int, deps: Set[int], parent: int, gate: bool })
    | TaskEdited({ task: int, deps: Set[int], parent: int, gate: bool })
    | TaskCanceled(int)
    | AttemptStarted({ task: int, session: int, ref: int, mergeBase: str })
    | AttemptProgressed(int)
    | AttemptClaimed({ attempt: int, sha: int })
    | ClaimApproved(int)
    | ClaimHandedUp(int)
    | AttemptNudged(int)
    | AttemptAccepted({ attempt: int, sha: int })
    | AttemptRejected({ attempt: int, reason: str })
    | FirstTurnStarted(int)
    | AttemptSettled({ attempt: int, outcome: str, stale: bool, commanded: bool })
    | GatePromoted(int)
    | LeadHandoverRequested({ id: int, from: int })
    | LeadHandoverCancelled(int)
    | LeadChanged({ to: int, request: int })
    | AttemptInterrupted({ attempt: int, interruption: int, eligible: bool })
    | AttemptStale(int)
    | AttemptFresh(int)
    | WorkerInputDelivered({ id: int, session: int })
    | ConstellationStateChanged(str)
    | NotificationQueued({ id: int, kind: str })
    | LeadNotified({ ids: Set[int], lead: int })
    | OutboxApplied(int)
    | AttemptRecoveryContinued(Recovery)
    | ResourceDeclared(int)
    | ResourceLeaseQueued(int)
    | ResourceLeased(int)
    | ResourceReleased(int)
    | ResourceLeaseCanceled(int)
    | ResourceRemoved
  type Event = { host: str, kind: EventKind }
  type View = {
    tasks: int -> Task, attempts: List[Attempt], lead: int, state: str,
    handoverRequest: int, handoverFrom: int, stale: Set[int], inputs: List[{ id: int, session: int }],
    approvals: List[int], handups: List[int], nudges: List[int], firstTurns: List[int],
    promotions: List[int], notes: int -> str, deliveries: List[Delivery],
    proofs: Set[{ attempt: int, interruption: int }],
    applied: List[int], recoveries: List[Recovery], waiters: List[int],
    holders: Set[int], requests: List[int], grants: List[int], capacity: int, canceled: Set[int],
  }
  type PlanOp = Add({ task: int, deps: Set[int], parent: int, gate: bool })
    | Edit({ task: int, deps: Set[int], parent: int, gate: bool, revision: int })
    | Cancel({ task: int, revision: int })
  type Remote = { attempt: int, sha: int }

  pure val emptyTask = { declared: false, deps: Set(), parent: -1, gate: false, canceled: false, revision: 0 }
  pure val empty: View = {
    tasks: TASKS.mapBy(_ => emptyTask), attempts: [], lead: 0, state: "planning",
    handoverRequest: -1, handoverFrom: -1, stale: Set(), inputs: [],
    approvals: [], handups: [], nudges: [], firstTurns: [],
    proofs: Set(),
    promotions: [], notes: Map(), deliveries: [], applied: [], recoveries: [],
    waiters: [], holders: Set(), requests: [], grants: [], capacity: CAPACITY, canceled: Set(),
  }
// The event log is durable; projections and pending notification IDs are always re-folded.
  pure def has(xs: List[int], x: int): bool = xs.indices().exists(i => xs[i] == x)
  pure def active(a: Attempt): bool = Set("working", "review").contains(a.status)
  pure def change(v: View, a: int, status: str, sha: int): View = {
    ...v, attempts: v.attempts.replaceAt(a, {
      ...v.attempts[a], status: status, sha: sha, revision: v.attempts[a].revision + 1,
    }),
  }
  pure def apply(v: View, e: EventKind): View = match e {
    | TaskDeclared(p) => { ...v, tasks: v.tasks.set(p.task, {
        declared: true, deps: p.deps, parent: p.parent, gate: p.gate, canceled: false, revision: 1,
      }) }
    | TaskEdited(p) => { ...v, tasks: v.tasks.set(p.task, {
        ...v.tasks.get(p.task), deps: p.deps, parent: p.parent, gate: p.gate, revision: v.tasks.get(p.task).revision + 1,
      }) }
    | TaskCanceled(t) => { ...v, tasks: v.tasks.set(t, {
        ...v.tasks.get(t), canceled: true, revision: v.tasks.get(t).revision + 1,
      }) }
    | AttemptStarted(p) => { ...v, attempts: v.attempts.append({
        task: p.task, session: p.session, ref: p.ref, status: "working", revision: 1, sha: -1, rejectionReason: "", mergeBase: p.mergeBase,
      }) }
    | AttemptProgressed(a) => change(v, a, v.attempts[a].status, v.attempts[a].sha)
    | AttemptClaimed(p) => change(v, p.attempt, "review", p.sha)
    | ClaimApproved(a) => { ...change(v, a, v.attempts[a].status, v.attempts[a].sha), approvals: v.approvals.append(a) }
    | ClaimHandedUp(a) => { ...change(v, a, v.attempts[a].status, v.attempts[a].sha), handups: v.handups.append(a) }
    | AttemptNudged(a) => { ...change(v, a, v.attempts[a].status, v.attempts[a].sha), nudges: v.nudges.append(a) }
    | AttemptAccepted(p) => change(v, p.attempt, "accepted", p.sha)
    | AttemptRejected(p) => {
        val changed = change(v, p.attempt, "rejected", v.attempts[p.attempt].sha)
        { ...changed, attempts: changed.attempts.replaceAt(p.attempt, {
          ...changed.attempts[p.attempt], rejectionReason: p.reason,
        }) }
      }
    | FirstTurnStarted(a) => { ...v, firstTurns: v.firstTurns.append(a) }
    | AttemptSettled(p) => change(v, p.attempt, p.outcome, v.attempts[p.attempt].sha)
    | GatePromoted(t) => { ...v, promotions: v.promotions.append(t), tasks: v.tasks.set(t, { ...v.tasks.get(t), revision: v.tasks.get(t).revision + 1 }) }
    | LeadHandoverRequested(p) => { ...v, handoverRequest: p.id, handoverFrom: p.from }
    | LeadHandoverCancelled(id) => if (v.handoverRequest == id) { ...v, handoverRequest: -1, handoverFrom: -1 } else v
    | LeadChanged(p) => { ...v, lead: p.to, handoverRequest: -1, handoverFrom: -1 }
    | AttemptInterrupted(p) => { ...v, proofs: if (p.eligible) v.proofs.union(Set({ attempt: p.attempt, interruption: p.interruption })) else v.proofs }
    | AttemptStale(a) => { ...v, stale: v.stale.union(Set(a)) }
    | AttemptFresh(a) => { ...v, stale: v.stale.exclude(Set(a)) }
    | WorkerInputDelivered(p) => { ...v, inputs: v.inputs.append(p) }
    | ConstellationStateChanged(s) => { ...v, state: s }
    | NotificationQueued(p) => { ...v, notes: v.notes.put(p.id, p.kind) }
    | LeadNotified(p) => { ...v, deliveries: p.ids.fold(v.deliveries, (acc, id) => acc.append({ id: id, lead: p.lead })) }
    | OutboxApplied(id) => { ...v, applied: v.applied.append(id) }
    | AttemptRecoveryContinued(p) => { ...v, recoveries: v.recoveries.append(p) }
    | ResourceDeclared(capacity) => { ...v, capacity: capacity }
    | ResourceRemoved => { ...v, capacity: 0 }
    | ResourceLeaseQueued(id) => { ...v, waiters: v.waiters.append(id), requests: v.requests.append(id) }
    | ResourceLeased(id) => { ...v, holders: v.holders.union(Set(id)), waiters: v.waiters.slice(1, v.waiters.length()), grants: v.grants.append(id) }
    | ResourceReleased(id) => { ...v, holders: v.holders.exclude(Set(id)) }
    | ResourceLeaseCanceled(id) => { ...v, waiters: v.waiters.select(waiter => waiter != id), canceled: v.canceled.union(Set(id)) }
  }
  pure def foldEvents(events: List[Event]): View = events.foldl(empty, (v, e) => apply(v, e.kind))
  pure def latest(v: View, t: int): int = v.attempts.indices().fold(-1, (acc, i) => if (v.attempts[i].task == t) i else acc)
  // Parent closure is bounded by TASKS; the wire supports arbitrary finite depth.
  pure def children(v: View, t: int): Set[int] = TASKS.filter(c =>
    v.tasks.get(c).declared and not(v.tasks.get(c).canceled) and v.tasks.get(c).parent == t)
  pure def descendants(v: View, t: int): Set[int] = TASKS.fold(children(v, t), (acc, _) =>
    acc.union(acc.fold(Set(), (out, c) => out.union(children(v, c)))))
  pure def lineage(v: View, t: int): Set[int] = if (v.tasks.get(t).parent < 0) Set() else TASKS.fold(
    Set(v.tasks.get(t).parent), (acc, _) =>
      acc.union(acc.fold(Set(), (out, p) => if (v.tasks.keys().contains(p) and v.tasks.get(p).parent >= 0)
        out.union(Set(v.tasks.get(p).parent)) else out)))
  pure def effectiveDeps(v: View, t: int): Set[int] = lineage(v, t).fold(v.tasks.get(t).deps,
    (acc, p) => if (v.tasks.keys().contains(p)) acc.union(v.tasks.get(p).deps) else acc)
  pure def leafAccepted(v: View, t: int): bool = not(v.tasks.get(t).canceled)
    and latest(v, t) >= 0 and v.attempts[latest(v, t)].status == "accepted"
  pure def acceptance(v: View): int -> bool = TASKS.fold(TASKS.mapBy(t => leafAccepted(v, t)), (states, _) =>
    TASKS.mapBy(t => {
      val kids = children(v, t)
      if (kids == Set()) leafAccepted(v, t)
      else not(v.tasks.get(t).canceled) and kids.forall(c => states.get(c))
        and effectiveDeps(v, t).forall(d => states.get(d))
    }))
  pure def accepted(v: View, t: int): bool = if (children(v, t) == Set()) leafAccepted(v, t)
    else acceptance(v).get(t)
  pure def ready(v: View, t: int): bool = v.tasks.get(t).declared and not(v.tasks.get(t).canceled)
    and effectiveDeps(v, t).forall(d => accepted(v, d))
  pure def leafState(v: View, t: int): str =
    if (v.tasks.get(t).canceled) "canceled"
    else if (latest(v, t) < 0 or v.attempts[latest(v, t)].status == "rejected")
      (if (ready(v, t)) "ready" else "waiting")
    else if (v.attempts[latest(v, t)].status == "accepted") "done"
    else v.attempts[latest(v, t)].status
  pure def taskStates(v: View): int -> str = TASKS.fold(TASKS.mapBy(t => leafState(v, t)), (states, _) =>
    TASKS.mapBy(t => {
      val kids = children(v, t)
      if (v.tasks.get(t).canceled or kids == Set()) leafState(v, t)
      else if (kids.exists(c => Set("working", "review", "blocked").contains(states.get(c)))) "working"
      else if (not(ready(v, t))) "waiting"
      else if (kids.forall(c => states.get(c) == "done")) "done"
      else if (kids.exists(c => states.get(c) == "ready")) "ready" else "waiting"
    }))
  pure def taskState(v: View, t: int): str =
    if (children(v, t) == Set()) leafState(v, t) else taskStates(v).get(t)
  pure def reach(v: View, t: int): Set[int] = TASKS.fold(effectiveDeps(v, t).union(children(v, t)), (acc, _) =>
    acc.union(acc.fold(Set(), (out, d) => out.union(effectiveDeps(v, d)).union(children(v, d)))))
  pure def validGraph(v: View): bool = TASKS.forall(t => all {
    not(reach(v, t).contains(t)),
    not(lineage(v, t).contains(t)),
    v.tasks.get(t).parent < 0 or (v.tasks.keys().contains(v.tasks.get(t).parent) and v.tasks.get(v.tasks.get(t).parent).declared),
    children(v, t) == Set() or (not(v.tasks.get(t).gate) and latest(v, t) < 0),
    v.tasks.get(t).canceled or (v.tasks.get(t).parent < 0 or not(v.tasks.get(v.tasks.get(t).parent).canceled)),
    v.tasks.get(t).canceled or effectiveDeps(v, t).forall(d => not(lineage(v, t).contains(d)) and not(lineage(v, d).contains(t))),
    v.tasks.get(t).canceled or effectiveDeps(v, t).forall(d => v.tasks.get(d).declared and not(v.tasks.get(d).canceled)),
  })
  pure def opEvents(v: View, op: PlanOp): List[EventKind] = match op {
    | Add(p) => if (not(v.tasks.get(p.task).declared)) [TaskDeclared(p)] else []
    | Edit(p) => if (v.tasks.get(p.task).declared and not(v.tasks.get(p.task).canceled)
        and v.tasks.get(p.task).revision == p.revision)
      [TaskEdited({ task: p.task, deps: p.deps, parent: p.parent, gate: p.gate })] else []
    | Cancel(p) => if (v.tasks.get(p.task).declared and not(v.tasks.get(p.task).canceled)
        and v.tasks.get(p.task).revision == p.revision) [TaskCanceled(p.task)] else []
  }
  pure def planEvents(v: View, ops: List[PlanOp]): List[EventKind] = {
    val batch = ops.foldl({ view: v, events: [], valid: true }, (acc, op) => {
      val events = opEvents(acc.view, op)
      { view: events.foldl(acc.view, (updated, e) => apply(updated, e)),
        events: acc.events.concat(events), valid: acc.valid and events.length() == 1 }
    })
    val roots = batch.events.foldl(Set(), (acc, e) => match e { | TaskCanceled(t) => acc.union(Set(t)) | _ => acc })
    val canceled = TASKS.filter(t => not(batch.view.tasks.get(t).canceled) and lineage(batch.view, t).intersect(roots) != Set())
    val events = canceled.fold(batch.events, (acc, t) => acc.append(TaskCanceled(t)))
    val updated = events.foldl(v, (acc, e) => apply(acc, e))
    val stopped = roots.union(canceled).forall(t => latest(v, t) < 0 or not(active(v.attempts[latest(v, t)])))
    if (batch.valid and stopped and validGraph(updated)) events.concat(promote(updated)) else []
  }
  pure def current(v: View, a: int, rev: int): bool = v.attempts.indices().contains(a)
    and latest(v, v.attempts[a].task) == a and active(v.attempts[a]) and v.attempts[a].revision == rev
  pure def promote(v: View): List[EventKind] = TASKS.fold([], (acc, t) =>
    if (v.tasks.get(t).gate and ready(v, t) and not(has(v.promotions, t))) acc.append(GatePromoted(t)) else acc)
  pure def finish(v: View, a: int, event: EventKind): List[EventKind] = {
    val updated = apply(v, event)
    val events = [event, NotificationQueued({ id: 10 + 2 * a + (if (v.attempts[a].status == "review") 1 else 0), kind: "settle" })]
    events.concat(promote(updated))
  }

  var log: List[Event]
  var offline: Set[int]
  var appConnected: bool
  var ownerAvailable: bool
  var outbox: int -> Remote
  var interruptions: int -> int
  val view = foldEvents(log)
  val delivered = view.deliveries.foldl(Set(), (acc, d) => acc.union(Set(d.id)))
  val pending = view.notes.keys().exclude(delivered)

  action init = all { log' = [], offline' = Set(), appConnected' = true,
    ownerAvailable' = true, outbox' = Map(), interruptions' = Map() }
  action commit(host: str, events: List[EventKind]): bool = all {
    log' = if (host == OWNER and ownerAvailable) events.foldl(log, (acc, e) => acc.append({ host: host, kind: e })) else log,
    offline' = offline, appConnected' = appConnected, ownerAvailable' = ownerAvailable,
    outbox' = outbox, interruptions' = interruptions,
  }
  action replay(events: List[Event]): bool = all {
    log' = log.concat(events), offline' = offline, appConnected' = appConnected,
    ownerAvailable' = ownerAvailable, outbox' = outbox, interruptions' = interruptions,
  }
  action plan(ops: List[PlanOp]): bool = commit(OWNER, planEvents(view, ops))
  action startWithMergeBase(t: int, s: int, ref: int, mergeBase: str): bool = commit(OWNER,
    if (view.state == "running" and children(view, t) == Set() and ready(view, t)
      and (not(view.tasks.get(t).gate) or has(view.promotions, t))
      and not(view.attempts.indices().exists(i => active(view.attempts[i]) and view.attempts[i].session == s))
      and (latest(view, t) < 0 and ref == -1 or latest(view, t) >= 0 and ref == latest(view, t) and not(active(view.attempts[ref]))))
    [AttemptStarted({ task: t, session: s, ref: ref, mergeBase: mergeBase })] else [])
  action start(t: int, s: int, ref: int): bool = startWithMergeBase(t, s, ref, "")
  pure def retryBrief(v: View, a: int): { reason: str, sha: int, mergeBase: str } = {
    val ref = v.attempts[a].ref
    { reason: if (ref >= 0) v.attempts[ref].rejectionReason else "",
      sha: if (ref >= 0) v.attempts[ref].sha else -1, mergeBase: v.attempts[a].mergeBase }
  }
  action startFirstTurn(a: int): bool = commit(OWNER,
    if (view.attempts.indices().contains(a) and view.attempts[a].status == "working"
      and not(has(view.firstTurns, a))) [FirstTurnStarted(a)] else [])
  action progress(a: int, rev: int): bool = commit(OWNER,
    if (current(view, a, rev) and view.attempts[a].status == "working") [AttemptProgressed(a)] else [])
  action claim(a: int, rev: int, sha: int, dirty: bool, onBranch: bool): bool = commit(OWNER,
    if (current(view, a, rev) and view.attempts[a].status == "working" and not(dirty) and onBranch)
    finish(view, a, AttemptClaimed({ attempt: a, sha: sha })) else [])
  action accept(a: int, rev: int, sha: int): bool = commit(OWNER,
    if (current(view, a, rev) and view.attempts[a].status == "review" and view.attempts[a].sha == sha)
    [AttemptAccepted({ attempt: a, sha: sha })].concat(promote(apply(view, AttemptAccepted({ attempt: a, sha: sha })))) else [])
  action rejectWithReason(a: int, rev: int, reason: str): bool = commit(OWNER,
    if (current(view, a, rev) and view.attempts[a].status == "review") [AttemptRejected({ attempt: a, reason: reason })] else [])
  action reject(a: int, rev: int): bool = rejectWithReason(a, rev, "fix")
  action stop(a: int, rev: int): bool = commit(OWNER,
    if (current(view, a, rev)) finish(view, a, AttemptSettled({ attempt: a, outcome: "lost", stale: offline.contains(view.attempts[a].session), commanded: true })) else [])
  action harnessFail(a: int): bool = commit(OWNER,
    if (view.attempts.indices().contains(a) and active(view.attempts[a]) and not(offline.contains(view.attempts[a].session)))
    finish(view, a, AttemptSettled({ attempt: a, outcome: "failed", stale: false, commanded: false })) else [])
  action ask(a: int, id: int): bool = commit(OWNER,
    if (view.attempts.indices().contains(a) and active(view.attempts[a]) and not(view.notes.keys().contains(id)))
    [NotificationQueued({ id: id, kind: "question" })] else [])
  action deliver = commit(OWNER,
    if (view.state == "running" and pending.size() > 0) [LeadNotified({ ids: pending, lead: view.lead })] else [])
  action requestHandover(id: int): bool = commit(OWNER,
    if (Set("planning", "running", "paused").contains(view.state))
      [LeadHandoverRequested({ id: id, from: view.lead })] else [])
  action cancelHandover: bool = commit(OWNER,
    if (view.handoverRequest >= 0) [LeadHandoverCancelled(view.handoverRequest)] else [])
  pure def handoverEvents(v: View, id: int, s: int): List[EventKind] = {
    val gates = v.attempts.indices().filter(a => active(v.attempts[a]) and v.attempts[a].session == v.lead and v.tasks.get(v.attempts[a].task).gate)
    gates.fold([], (events, a) => events.concat(finish(v, a, AttemptSettled({ attempt: a, outcome: "lost", stale: false, commanded: true })))).append(LeadChanged({ to: s, request: id }))
  }
  action finishHandover(id: int, s: int): bool = commit(OWNER,
    if (view.handoverRequest == id and view.handoverFrom == view.lead and s != view.lead
      and Set("planning", "running", "paused").contains(view.state))
      handoverEvents(view, id, s) else [])
  action handover(s: int): bool = commit(OWNER, if (s != view.lead) handoverEvents(view, -1, s) else [])
  pure def lifecycleTransition(previous: str, target: str): bool =
    previous == "planning" and target == "running" or previous == "running" and Set("paused", "completed").contains(target)
    or previous == "paused" and Set("running", "completed").contains(target) or previous == "completed" and target == "archived"
  action setState(s: str): bool = commit(OWNER, if (lifecycleTransition(view.state, s)) [ConstellationStateChanged(s)] else [])
  action interrupt(a: int): bool = all {
    log' = log.append({ host: OWNER, kind: AttemptInterrupted({ attempt: a, interruption: if (interruptions.keys().contains(a)) interruptions.get(a) + 1 else 1, eligible: true }) }), offline' = offline, appConnected' = appConnected, ownerAvailable' = ownerAvailable,
    outbox' = outbox, interruptions' = interruptions.put(a, if (interruptions.keys().contains(a)) interruptions.get(a) + 1 else 1),
  }
  action recover(a: int): bool = commit(OWNER,
    if (view.attempts.indices().contains(a) and view.attempts[a].status == "working"
      and interruptions.keys().contains(a) and interruptions.get(a) == 1 and view.proofs.contains({ attempt: a, interruption: interruptions.get(a) }) and not(view.recoveries.indices().exists(i => view.recoveries[i].attempt == a)))
    [AttemptRecoveryContinued({ attempt: a, interruption: interruptions.get(a) })] else [])
  action restart = all { log' = log, offline' = offline, appConnected' = appConnected,
    ownerAvailable' = true, outbox' = outbox, interruptions' = interruptions }
  action availability(app: bool, owner: bool, stale: Set[int]): bool = all {
    log' = log, offline' = stale, appConnected' = app, ownerAvailable' = owner,
    outbox' = outbox, interruptions' = interruptions,
  }
  action enqueue(id: int, a: int, sha: int): bool = all {
    not(outbox.keys().contains(id)), log' = log, offline' = offline,
    appConnected' = appConnected, ownerAvailable' = ownerAvailable,
    outbox' = outbox.put(id, { attempt: a, sha: sha }), interruptions' = interruptions,
  }
  action relay(id: int): bool = commit(OWNER,
    if (appConnected and outbox.keys().contains(id) and not(has(view.applied, id))) {
      val r = outbox.get(id)
      val appliedEvents = [OutboxApplied(id)]
      appliedEvents.concat(if (view.attempts.indices().contains(r.attempt)
        and current(view, r.attempt, view.attempts[r.attempt].revision) and view.attempts[r.attempt].status == "working")
        finish(view, r.attempt, AttemptClaimed({ attempt: r.attempt, sha: r.sha })) else [])
    } else [])
  action request(id: int): bool = commit(OWNER, if (view.capacity > 0 and not(has(view.requests, id))) [ResourceLeaseQueued(id)] else [])
  action grant = commit(OWNER, if (view.waiters.length() > 0 and view.holders.size() < view.capacity) [ResourceLeased(view.waiters[0])] else [])
  action cancelLease(id: int): bool = commit(OWNER, if (has(view.waiters, id)) [ResourceLeaseCanceled(id)] else [])
  action release(id: int): bool = commit(OWNER, if (view.holders.contains(id)) [ResourceReleased(id)] else [])

  action step = {
    nondet t = TASKS.oneOf()
    nondet s = SESSIONS.oneOf()
    nondet id = IDS.oneOf()
    nondet a = view.attempts.indices().union(Set(-1)).oneOf()
    val rev = if (view.attempts.indices().contains(a)) view.attempts[a].revision else 1
    nondet dep = TASKS.oneOf()
    any {
      plan([Add({ task: t, deps: Set(), parent: -1, gate: t == 2 })]),
      plan([Edit({ task: t, deps: Set(dep), parent: -1, gate: t == 2, revision: rev })]),
      plan([Cancel({ task: t, revision: rev })]),
      start(t, s, latest(view, t)), progress(a, rev), claim(a, rev, 42, false, true),
      claim(a, rev, 42, true, true), accept(a, rev, 42), accept(a, rev, 43), reject(a, rev), startFirstTurn(a), stop(a, rev), harnessFail(a),
      ask(a, id), deliver, handover(s), requestHandover(id), cancelHandover, finishHandover(id, s), setState("running"), setState("paused"),
      all { TASKS.forall(task => accepted(view, task)), setState("completed") },
      setState("archived"), interrupt(a), recover(a), restart,
      availability(false, true, Set(s)), availability(true, false, Set()), availability(true, true, Set()),
      enqueue(id, a, 42), relay(id), request(id), grant, release(id), cancelLease(id), commit("worker-host", [LeadChanged({ to: s, request: -1 })]),
    }
  }

  val graphAcyclic = validGraph(view)
  val firstTurnAtMostOnce = view.firstTurns.length() == view.firstTurns.foldl(Set(), (acc, a) => acc.union(Set(a))).size()
  val causesPointBackward = view.attempts.indices().forall(i => view.attempts[i].ref == -1
    or view.attempts[i].ref >= 0 and view.attempts[i].ref < i and view.attempts[view.attempts[i].ref].task == view.attempts[i].task)
  val taskFollowsLatestAttempt = TASKS.forall(t => latest(view, t) < 0 or view.tasks.get(t).canceled
    or taskState(view, t) == leafState(view, t))
  val gatePromotedOnlyAfterAccepted = log.indices().forall(i => match log[i].kind {
    | GatePromoted(t) => ready(foldEvents(log.slice(0, i)), t) and view.tasks.get(t).gate
    | _ => true
  }) and view.promotions.length() == view.promotions.foldl(Set(), (acc, x) => acc.union(Set(x))).size()
  val handoverRequestOrdered = log.indices().forall(i => {
    val before = foldEvents(log.slice(0, i))
    match log[i].kind {
      | LeadHandoverRequested(p) => p.from == before.lead and Set("planning", "running", "paused").contains(before.state)
      | LeadChanged(p) => p.request < 0 or (before.handoverRequest == p.request and before.handoverFrom == before.lead
          and Set("planning", "running", "paused").contains(before.state))
      | _ => true
    }
  })
  val inputDeliveredAtMostOnce = view.inputs.length() == view.inputs.foldl(Set(), (acc, p) => acc.union(Set(p))).size()
  val oneLead = SESSIONS.contains(view.lead)
  val oneActiveAttemptPerSession = SESSIONS.forall(s => view.attempts.select(a => a.session == s and active(a)).length() <= 1)
  val queuedIds = log.foldl([], (acc, e) => match e.kind {
    | NotificationQueued(p) => acc.append(p.id)
    | _ => acc
  })
  val settlesHaveNotifications = log.indices().forall(i => match log[i].kind {
    | AttemptClaimed(_) => i + 1 < log.length() and (match log[i + 1].kind { | NotificationQueued(_) => true | _ => false })
    | AttemptSettled(_) => i + 1 < log.length() and (match log[i + 1].kind { | NotificationQueued(_) => true | _ => false })
    | _ => true
  })
  val exactlyOnceDelivery = queuedIds.length() == queuedIds.foldl(Set(), (acc, id) => acc.union(Set(id))).size()
    and settlesHaveNotifications and view.deliveries.length() == delivered.size()
    and delivered.subseteq(view.notes.keys()) and pending.union(delivered) == view.notes.keys()
  val settledAttemptImmutable = log.indices().forall(i => {
    val before = foldEvents(log.slice(0, i))
    val after = foldEvents(log.slice(0, i + 1))
    before.attempts.indices().forall(a => active(before.attempts[a]) or before.attempts[a] == after.attempts[a])
  })
  val outboxAppliedExactlyOnce = view.applied.length() == view.applied.foldl(Set(), (acc, x) => acc.union(Set(x))).size()
  val onlyOwnerCommits = log.indices().forall(i => log[i].host == OWNER)
  val recoveryHasEligibleProof = log.indices().forall(i => match log[i].kind {
    | AttemptRecoveryContinued(p) => { val before = foldEvents(log.slice(0, i)); before.proofs.contains({ attempt: p.attempt, interruption: p.interruption }) }
    | _ => true
  })
  val recoveryAtMostOnce = view.recoveries.length() == view.recoveries.foldl(Set(), (acc, x) => acc.union(Set(x))).size()
    and view.attempts.indices().forall(a => view.recoveries.select(r => r.attempt == a).length() <= 1)
  val staleNeverSettlesWithoutCommand = log.indices().forall(i => match log[i].kind {
    | AttemptSettled(p) => not(p.stale) or p.commanded
    | _ => true
  })
  val noOldLeadDelivery = log.indices().forall(i => match log[i].kind {
    | LeadNotified(p) => p.lead == foldEvents(log.slice(0, i)).lead
    | _ => true
  })
  val acceptanceMatchesClaim = log.indices().forall(i => match log[i].kind {
    | AttemptAccepted(p) => foldEvents(log.slice(0, i)).attempts[p.attempt].status == "review"
      and foldEvents(log.slice(0, i)).attempts[p.attempt].sha == p.sha
    | _ => true
  })
  val reviewMetadataValid = log.indices().forall(i => match log[i].kind {
    | ClaimApproved(a) => foldEvents(log.slice(0, i)).attempts[a].status == "review"
    | ClaimHandedUp(a) => foldEvents(log.slice(0, i)).attempts[a].status == "review"
    | AttemptNudged(a) => foldEvents(log.slice(0, i)).attempts[a].status == "working"
    | _ => true
  }) and view.nudges.length() == view.nudges.foldl(Set(), (acc, a) => acc.union(Set(a))).size()
    and view.approvals.length() == view.approvals.foldl(Set(), (acc, a) => acc.union(Set(a))).size()
    and view.handups.length() == view.handups.foldl(Set(), (acc, a) => acc.union(Set(a))).size()
  val lifecycleValid = log.indices().forall(i => match log[i].kind {
    | ConstellationStateChanged(s) => lifecycleTransition(foldEvents(log.slice(0, i)).state, s)
    | _ => true
  })
  val resourceCapacity = log.indices().forall(i => {
    val v = foldEvents(log.slice(0, i + 1))
    v.holders.size() <= v.capacity
  })
  val resourceRemovalSafe = log.indices().forall(i => match log[i].kind {
    | ResourceRemoved => foldEvents(log.slice(0, i)).holders == Set() and foldEvents(log.slice(0, i)).waiters == []
    | ResourceLeaseQueued(_) => foldEvents(log.slice(0, i)).capacity > 0
    | _ => true
  })
  val fifoGrantOrder = log.indices().forall(i => match log[i].kind {
    | ResourceLeased(id) => foldEvents(log.slice(0, i)).waiters.length() > 0 and foldEvents(log.slice(0, i)).waiters[0] == id
    | _ => true
  })
  // Liveness requires the owner to return, holders to release, and the grant action to run fairly.
  temporal fifoWaiterEventuallyGranted = IDS.forall(id =>
    (always(ownerAvailable and view.capacity > 0 and not(view.canceled.contains(id))) and grant.weakFair(log) and release(id).weakFair(log)
      and IDS.forall(holder => release(holder).weakFair(log)))
    implies (has(view.waiters, id) leadsTo has(view.grants, id)))
  temporal everyNotificationEventuallyDelivered =
    (always(ownerAvailable and view.state == "running") and deliver.weakFair(log))
    implies (0.to(30).forall(id => view.notes.keys().contains(id) leadsTo delivered.contains(id)))
  val safety = all {
    graphAcyclic, causesPointBackward, taskFollowsLatestAttempt, gatePromotedOnlyAfterAccepted,
    oneLead, firstTurnAtMostOnce, oneActiveAttemptPerSession, exactlyOnceDelivery, settledAttemptImmutable,
    outboxAppliedExactlyOnce, onlyOwnerCommits, recoveryAtMostOnce, recoveryHasEligibleProof, staleNeverSettlesWithoutCommand,
    noOldLeadDelivery, handoverRequestOrdered, inputDeliveredAtMostOnce, lifecycleValid, reviewMetadataValid, resourceCapacity, resourceRemovalSafe, fifoGrantOrder, acceptanceMatchesClaim,
  }
  val witnessClaim = view.attempts.indices().exists(i => view.attempts[i].status == "review")
  val witnessAccepted = view.attempts.indices().exists(i => view.attempts[i].status == "accepted")
  val witnessGate = view.promotions.length() > 0
  val witnessHandover = view.lead != 0
  val witnessDelivery = view.deliveries.length() > 0
  val witnessRelay = view.applied.length() > 0
  val witnessRecovery = view.recoveries.length() > 0
  val witnessLease = view.grants.length() > 0
}


module current_constellations {
  import constellations(
    TASKS = Set(0, 1, 2), SESSIONS = Set(0, 1, 2, 3), IDS = Set(0, 1, 2, 3, 4, 5),
    OWNER = "lead-host", CAPACITY = 2,
  ).*
}

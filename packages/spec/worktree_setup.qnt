/** Initial setup precedes dispatch; changed retry setup waits for the previous Turn's boundary. */
module worktree_setup {
  type View = { setup: str, id: int, state: str, attempt: bool, slot: bool, turn: bool, deferred: bool, pending: bool, boundary: bool, inputs: int }
  type Event = Start(int) | Finish({ id: int, ok: bool }) | Recover | Dispatch | RetryAttempt | Boundary | Acquire | FirstTurn | Input | Archive
  pure val empty: View = { setup: "none", id: -1, state: "dormant", attempt: false, slot: false, turn: false, deferred: false, pending: false, boundary: true, inputs: 0 }
  pure def finish(v: View, ok: bool): View = {
    ...v, setup: if (ok) "completed" else "failed", pending: v.deferred and not(ok), slot: v.slot and ok,
    state: if (v.state == "archived") "archived" else if (ok) "dormant" else "failed",
  }
  pure def apply(v: View, e: Event): View = match e {
    | Start(id) => if (v.setup != "running" and v.state != "archived" and
        (not(v.attempt) or v.deferred and v.pending and v.boundary and not(v.turn))) { ...v, setup: "running", id: id } else v
    | Finish(p) => if (v.setup == "running" and v.id == p.id) finish(v, p.ok) else v
    | Recover => if (v.setup == "running") finish(v, false) else v
    | Dispatch => if (not(v.attempt) and Set("none", "completed").contains(v.setup) and v.state == "dormant") { ...v, attempt: true } else v
    | RetryAttempt => if (not(v.attempt) and Set("none", "completed").contains(v.setup) and v.state == "dormant")
        { ...v, attempt: true, deferred: true, pending: true, boundary: false } else v
    | Boundary => { ...v, boundary: true }
    | Acquire => if (v.attempt and v.setup != "failed" and v.state != "archived") { ...v, slot: true } else v
    | FirstTurn => if (v.attempt and v.slot and v.boundary and not(v.pending) and Set("none", "completed").contains(v.setup) and v.state != "archived") { ...v, turn: true } else v
    | Input => if (v.turn) { ...v, inputs: v.inputs + 1 } else v
    | Archive => if (not(v.turn)) { ...v, state: "archived" } else v
  }
  var view: View
  action init = view' = empty
  action publish(e: Event): bool = view' = apply(view, e)
  action step = {
    nondet e = Set(Start(0), Start(1), Finish({ id: 0, ok: true }), Finish({ id: 1, ok: false }), Recover, Dispatch, RetryAttempt, Boundary, Acquire, FirstTurn, Input, Archive).oneOf()
    publish(e)
  }
  val safety = all {
    view.turn implies (view.attempt and view.slot and not(view.pending)),
    view.attempt and not(view.deferred) implies Set("none", "completed").contains(view.setup),
    view.setup == "running" implies (not(view.turn) and (if (view.deferred) view.boundary else not(view.attempt) and not(view.slot))),
    view.setup == "failed" implies (Set("failed", "archived").contains(view.state) and not(view.slot)),
    view.inputs > 0 implies view.turn,
  }
}

module worktree_setup_test {
  import worktree_setup.* from "./worktree_setup"
  run failedSetupHasAttentionWithoutWorkingTest = init.then(publish(Start(0))).then(publish(Finish({ id: 0, ok: false }))).then(publish(Dispatch)).expect(view.state == "failed" and not(view.attempt) and safety)
  run retryCompletesBeforeAcquisitionAndFirstTurnTest = init.then(publish(Start(0))).then(publish(Recover)).then(publish(Start(1))).then(publish(Finish({ id: 1, ok: true }))).then(publish(FirstTurn)).expect(not(view.turn) and safety).then(publish(Dispatch)).then(publish(Acquire)).then(publish(FirstTurn)).expect(view.turn and safety)
  run staleCompletionDoesNotOverwriteOrReopenTest = init.then(publish(Start(0))).then(publish(Recover)).then(publish(Start(1))).then(publish(Finish({ id: 0, ok: true }))).expect(view.setup == "running" and safety).then(publish(Archive)).then(publish(Finish({ id: 1, ok: false }))).expect(view.state == "archived" and safety)
  run deferredSetupWaitsForBoundaryAndPrecedesBriefAndInputsTest = init.then(publish(RetryAttempt)).then(publish(Acquire)).then(publish(Start(0))).then(publish(Input)).expect(view.pending and view.setup == "none" and view.inputs == 0 and safety).then(publish(Boundary)).then(publish(Start(1))).then(publish(FirstTurn)).expect(not(view.turn) and safety).then(publish(Finish({ id: 1, ok: true }))).then(publish(FirstTurn)).then(publish(Input)).expect(view.turn and view.inputs == 1 and safety)
  run deferredRestartFailureReleasesSlotBeforeRepairTest = init.then(publish(RetryAttempt)).then(publish(Acquire)).then(publish(Boundary)).then(publish(Start(0))).then(publish(Recover)).expect(view.pending and not(view.slot) and safety).then(publish(Start(1))).then(publish(Finish({ id: 1, ok: true }))).then(publish(Acquire)).then(publish(FirstTurn)).expect(view.turn and safety)
}

/** Steer addresses the old Turn; only new Turns queue behind startup, in arrival order. */
module session_input_queue {
  type View = { pending: bool, failed: bool, old: bool, working: bool, brief: bool, queued: List[int], delivered: List[int], oldSteers: int }
  type Event = RetryAttempt | Boundary | SetupFailed | FirstBrief | Steer | Prompt(int) | EndTurn | DeliverNext
  pure val empty: View = { pending: false, failed: false, old: true, working: false, brief: false, queued: [], delivered: [], oldSteers: 0 }
  pure def apply(v: View, e: Event): View = match e {
    | RetryAttempt => if (not(v.failed) and not(v.brief)) { ...v, pending: true } else v
    | Boundary => { ...v, old: false }
    | SetupFailed => if (not(v.old)) { ...v, failed: true, pending: false } else v
    | FirstBrief => if (v.pending and not(v.old) and not(v.failed)) { ...v, pending: false, brief: true, working: true } else v
    | Steer => if (v.old) { ...v, oldSteers: v.oldSteers + 1 } else v
    | Prompt(id) => { ...v, queued: v.queued.append(id) }
    | EndTurn => { ...v, working: false }
    | DeliverNext => if (not(v.pending) and not(v.old) and not(v.working) and (v.brief or v.failed) and v.delivered.length() < v.queued.length())
        { ...v, working: true, delivered: v.delivered.append(v.queued.nth(v.delivered.length())) } else v
  }
  var view: View
  action init = view' = empty
  action publish(e: Event): bool = view' = apply(view, e)
  action step = {
    nondet e = Set(RetryAttempt, Boundary, SetupFailed, FirstBrief, Steer, Prompt(0), Prompt(1), Prompt(2), EndTurn, DeliverNext).oneOf()
    publish(e)
  }
  val safety = all {
    view.delivered.indices().forall(i => view.delivered.nth(i) == view.queued.nth(i)),
    view.delivered.length() <= view.queued.length(),
    view.brief implies not(view.old),
    view.failed implies not(view.pending),
  }
}
module session_input_queue_test {
  import session_input_queue.* from "./worktree_setup"
  run steerReachesOldTurnWhileNewPromptsWaitTest = init.then(publish(RetryAttempt)).then(publish(Prompt(1))).then(publish(Steer)).expect(view.oldSteers == 1 and view.delivered == []).then(publish(Boundary)).then(publish(FirstBrief)).then(publish(DeliverNext)).expect(view.delivered == [] and safety)
  run laterPromptsJoinFifoTest = init.then(publish(RetryAttempt)).then(publish(Prompt(1))).then(publish(Prompt(2))).then(publish(Boundary)).then(publish(FirstBrief)).then(publish(EndTurn)).then(publish(DeliverNext)).then(publish(Prompt(3))).then(publish(DeliverNext)).expect(view.delivered == [1] and safety).then(publish(EndTurn)).then(publish(DeliverNext)).then(publish(EndTurn)).then(publish(DeliverNext)).expect(view.delivered == [1,2,3] and safety)
  run failedSetupClearsFenceForRepairInputTest = init.then(publish(RetryAttempt)).then(publish(Prompt(1))).then(publish(Boundary)).then(publish(SetupFailed)).then(publish(DeliverNext)).expect(not(view.pending) and view.delivered == [1] and safety)
}

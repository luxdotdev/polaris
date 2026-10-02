/** First worker startup: setup commits before the Attempt, acquired slot and first Turn. */
module worktree_setup {
  type View = { setup: str, id: int, state: str, attempt: bool, slot: bool, turn: bool }
  type Event = Start(int) | Finish({ id: int, ok: bool }) | Recover | Dispatch | Acquire | FirstTurn | Archive
  pure val empty: View = { setup: "none", id: -1, state: "dormant", attempt: false, slot: false, turn: false }
  pure def finish(v: View, ok: bool): View = {
    ...v, setup: if (ok) "completed" else "failed",
    state: if (v.state == "archived") "archived" else if (ok) "dormant" else "failed",
  }
  pure def apply(v: View, e: Event): View = match e {
    | Start(id) => if (v.setup != "running" and not(v.attempt) and v.state != "archived") { ...v, setup: "running", id: id } else v
    | Finish(p) => if (v.setup == "running" and v.id == p.id) finish(v, p.ok) else v
    | Recover => if (v.setup == "running") finish(v, false) else v
    | Dispatch => if (Set("none", "completed").contains(v.setup) and v.state == "dormant") { ...v, attempt: true } else v
    | Acquire => if (v.attempt) { ...v, slot: true } else v
    | FirstTurn => if (v.attempt and v.slot and v.state != "archived") { ...v, turn: true } else v
    | Archive => if (not(v.turn)) { ...v, state: "archived" } else v
  }
  var view: View
  action init = view' = empty
  action publish(e: Event): bool = view' = apply(view, e)
  action step = {
    nondet e = Set(Start(0), Start(1), Finish({ id: 0, ok: true }), Finish({ id: 1, ok: false }), Recover, Dispatch, Acquire, FirstTurn, Archive).oneOf()
    publish(e)
  }
  val safety = all {
    view.turn implies (view.attempt and view.slot),
    view.attempt implies Set("none", "completed").contains(view.setup),
    view.setup == "running" implies (not(view.attempt) and not(view.slot) and not(view.turn)),
    view.setup == "failed" implies Set("failed", "archived").contains(view.state),
  }
}

module worktree_setup_test {
  import worktree_setup.* from "./worktree_setup"
  run failedSetupHasAttentionWithoutWorkingTest = init.then(publish(Start(0))).then(publish(Finish({ id: 0, ok: false }))).then(publish(Dispatch)).expect(view.state == "failed" and not(view.attempt) and safety)
  run retryCompletesBeforeAcquisitionAndFirstTurnTest = init.then(publish(Start(0))).then(publish(Recover)).then(publish(Start(1))).then(publish(Finish({ id: 1, ok: true }))).then(publish(FirstTurn)).expect(not(view.turn) and safety).then(publish(Dispatch)).then(publish(Acquire)).then(publish(FirstTurn)).expect(view.turn and safety)
  run staleCompletionDoesNotOverwriteOrReopenTest = init.then(publish(Start(0))).then(publish(Recover)).then(publish(Start(1))).then(publish(Finish({ id: 0, ok: true }))).expect(view.setup == "running" and safety).then(publish(Archive)).then(publish(Finish({ id: 1, ok: false }))).expect(view.state == "archived" and safety)
}

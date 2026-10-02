/** Contract model for future language consumers; no language handlers are installed by P1. */
module languages {
  type Context = { generation: int, sequence: int, version: int, requestVersion: int, requestGeneration: int, delivered: int }
  type Operation = { prepared: bool, applied: bool, drafts: bool, receipt: bool, acknowledged: bool, owned: bool, restored: bool }
  type Event = Sync({ context: int, generation: int, sequence: int, previous: int, version: int })
    | Request({ context: int, generation: int, sequence: int, version: int })
    | Result({ context: int, generation: int, version: int })
    | Cancel(int) | Restart(int) | Prepare | Apply | PersistDrafts | PersistReceipt | Acknowledge | DiskEdit | Undo | Crash

  pure val emptyContext = { generation: 1, sequence: 0, version: 0, requestVersion: -1, requestGeneration: -1, delivered: -1 }
  pure val emptyOperation = { prepared: false, applied: false, drafts: false, receipt: false, acknowledged: false, owned: false, restored: false }
  var contexts: int -> Context
  var operation: Operation

  action init = all { contexts' = Map(0 -> emptyContext, 1 -> emptyContext), operation' = emptyOperation }
  action unchanged = all { contexts' = contexts, operation' = operation }
  action updateContext(id: int, context: Context): bool = all { contexts' = contexts.set(id, context), operation' = operation }
  action updateOperation(updated: Operation): bool = all { contexts' = contexts, operation' = updated }

  action publish(e: Event): bool = match e {
    | Sync(p) => {
      val c = contexts.get(p.context)
      if (p.generation == c.generation and p.sequence == c.sequence + 1 and p.previous == c.version and p.version > c.version)
        updateContext(p.context, { ...c, sequence: p.sequence, version: p.version, requestVersion: -1, requestGeneration: -1, delivered: -1 }) else unchanged
    }
    | Request(p) => {
      val c = contexts.get(p.context)
      if (p.generation == c.generation and p.sequence <= c.sequence and p.version == c.version)
        updateContext(p.context, { ...c, requestVersion: p.version, requestGeneration: p.generation }) else unchanged
    }
    | Result(p) => {
      val c = contexts.get(p.context)
      if (p.generation == c.generation and p.generation == c.requestGeneration and p.version == c.requestVersion and p.version == c.version)
        updateContext(p.context, { ...c, delivered: p.version, requestVersion: -1, requestGeneration: -1 }) else unchanged
    }
    | Cancel(id) => updateContext(id, { ...contexts.get(id), requestVersion: -1, requestGeneration: -1 })
    | Restart(id) => updateContext(id, { ...emptyContext, generation: contexts.get(id).generation + 1 })
    | Prepare => if (not(operation.prepared)) updateOperation({ ...operation, prepared: true }) else unchanged
    | Apply => if (operation.prepared and not(operation.applied) and not(operation.restored)) updateOperation({ ...operation, applied: true, owned: true }) else unchanged
    | PersistDrafts => if (operation.applied) updateOperation({ ...operation, drafts: true }) else unchanged
    | PersistReceipt => if (operation.applied) updateOperation({ ...operation, receipt: true }) else unchanged
    | Acknowledge => if (operation.applied and operation.drafts and operation.receipt) updateOperation({ ...operation, acknowledged: true }) else unchanged
    | DiskEdit => updateOperation({ ...operation, owned: false })
    | Undo => if (operation.applied and operation.owned) updateOperation({ ...operation, restored: true, owned: false }) else unchanged
    | Crash => all {
      contexts' = contexts.keys().mapBy(id => { ...emptyContext, generation: contexts.get(id).generation + 1 }),
      operation' = operation,
    }
  }
  action step = {
    nondet id = Set(0, 1).oneOf()
    nondet generation = Set(1, 2, 3).oneOf()
    nondet version = Set(0, 1, 2).oneOf()
    nondet sequence = Set(0, 1, 2).oneOf()
    nondet e = Set(
      Sync({ context: id, generation: generation, sequence: sequence, previous: version - 1, version: version }),
      Request({ context: id, generation: generation, sequence: sequence, version: version }),
      Result({ context: id, generation: generation, version: version }),
      Cancel(id), Restart(id), Prepare, Apply, PersistDrafts, PersistReceipt, Acknowledge, DiskEdit, Undo, Crash
    ).oneOf()
    publish(e)
  }
  val safety = all {
    contexts.keys().forall(id => {
      val c = contexts.get(id)
      all { c.delivered == -1 or c.delivered == c.version, c.requestGeneration == -1 or c.requestGeneration == c.generation }
    }),
    operation.acknowledged implies (operation.applied and operation.drafts and operation.receipt),
    operation.restored implies operation.applied,
  }
}

module languages_test {
  import languages.* from "./languages"
  run orderingAndTwoClientsTest = init
    .then(publish(Sync({ context: 0, generation: 1, sequence: 2, previous: 0, version: 1 })))
    .expect(contexts.get(0).sequence == 0)
    .then(publish(Sync({ context: 0, generation: 1, sequence: 1, previous: 0, version: 1 })))
    .then(publish(Request({ context: 1, generation: 1, sequence: 1, version: 1 })))
    .expect(contexts.get(1) == emptyContext and safety)
  run staleResultAndRestartTest = init
    .then(publish(Request({ context: 0, generation: 1, sequence: 0, version: 0 })))
    .then(publish(Sync({ context: 0, generation: 1, sequence: 1, previous: 0, version: 1 })))
    .then(publish(Result({ context: 0, generation: 1, version: 0 })))
    .expect(contexts.get(0).delivered == -1)
    .then(publish(Restart(0)))
    .then(publish(Result({ context: 0, generation: 1, version: 1 })))
    .expect(contexts.get(0).generation == 2 and contexts.get(0).delivered == -1 and safety)
  run durableAckAndGuardedUndoTest = init.then(publish(Prepare)).then(publish(Apply)).then(publish(Acknowledge))
    .expect(not(operation.acknowledged))
    .then(publish(PersistDrafts)).then(publish(PersistReceipt)).then(publish(Acknowledge)).then(publish(Crash))
    .expect(operation.acknowledged and safety)
    .then(publish(DiskEdit)).then(publish(Undo)).expect(not(operation.restored) and safety)
  run retryDoesNotApplyAgainTest = init.then(publish(Prepare)).then(publish(Apply)).then(publish(Undo)).then(publish(Apply))
    .expect(operation.restored and not(operation.owned) and safety)
}

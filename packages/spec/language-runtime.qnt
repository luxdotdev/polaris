/** Ephemeral Host process state: no draft text or executable configuration is durable model data. */
module language_runtime {
  type Signal = Demand | Ready | Empty | Grace | Fail(bool) | Retry | Disconnect | Revoke | Restart | Stop
  var phase: str
  var attempts: int
  action init = all { phase' = "stopped", attempts' = 0 }
  pure def decidePhase(p: str, e: Signal): str = match e {
    | Disconnect => "stopped"
    | Revoke => "untrusted"
    | Stop => "stopped"
    | Restart => "stopped"
    | Demand => if (Set("stopped", "untrusted").contains(p)) "starting" else if (p == "grace") "ready" else p
    | Ready => if (p == "starting") "ready" else p
    | Empty => if (Set("starting", "ready").contains(p)) "grace" else if (p == "backoff") "stopped" else p
    | Grace => if (p == "grace") "stopped" else p
    | Fail(retry) => if (Set("starting", "ready", "grace").contains(p)) { if (retry) "backoff" else "failed" } else p
    | Retry => if (p == "backoff") "starting" else p
  }
  action publish(e: Signal): bool = all {
    phase' = decidePhase(phase, e),
    attempts' = match e {
      | Fail(_) => if (Set("starting", "ready", "grace").contains(phase)) attempts + 1 else attempts
      | Restart => 0
      | _ => attempts
    },
  }
  action step = {
    nondet e = Set(Demand, Ready, Empty, Grace, Fail(attempts < 2), Retry, Disconnect, Revoke, Restart, Stop).oneOf()
    publish(e)
  }
  val safety = all {
    Set("stopped", "untrusted", "starting", "ready", "grace", "backoff", "failed").contains(phase),
    phase == "backoff" implies attempts <= 2,
  }
}

module language_runtime_test {
  import language_runtime.* from "./language-runtime"
  run demandGraceTest = init.then(publish(Demand)).then(publish(Ready)).then(publish(Empty))
    .expect(phase == "grace").then(publish(Demand)).expect(phase == "ready")
    .then(publish(Empty)).then(publish(Grace)).expect(phase == "stopped" and safety)
  run retryBudgetTest = init.then(publish(Demand)).then(publish(Fail(true))).then(publish(Retry))
    .then(publish(Fail(true))).then(publish(Retry)).then(publish(Fail(false)))
    .expect(phase == "failed" and attempts == 3 and safety)
    .then(publish(Demand)).expect(phase == "failed")
    .then(publish(Restart)).then(publish(Demand)).expect(phase == "starting" and attempts == 0)
  run revokeAndDisconnectTest = init.then(publish(Demand)).then(publish(Revoke))
    .expect(phase == "untrusted").then(publish(Ready)).expect(phase == "untrusted")
    .then(publish(Disconnect)).expect(phase == "stopped" and safety)
}

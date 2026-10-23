/** Ephemeral Extension RPC reservations, before payload decoding or handler forking (ENG-418). */
module rpc_admission {
  pure val CONNECTIONS = 0.to(3)
  pure val IDS = 0.to(3)
  pure val PER_CONNECTION = 2
  pure val TOTAL = 3
  type Request = (int, int)
  var reserved: Set[Request]
  var active: Set[Request]
  var terminal: Set[Request]
  var closed: Set[int]
  var allowed: bool

  action init = all {
    reserved' = Set(), active' = Set(), terminal' = Set(), closed' = Set(), allowed' = false,
  }
  pure def count(requests: Set[Request], c: int): int = requests.filter(r => r._1 == c).size()
  action acquire(c: int, id: int): bool = {
    val r = (c, id)
    val ok = not(closed.contains(c)) and not(reserved.contains(r))
      and count(reserved, c) < PER_CONNECTION and reserved.size() < TOTAL
    all {
      allowed' = ok, reserved' = if (ok) reserved.union(Set(r)) else reserved,
      active' = active, terminal' = terminal, closed' = closed,
    }
  }
  action start(r: Request): bool = all {
    reserved.contains(r), not(terminal.contains(r)),
    active' = active.union(Set(r)), reserved' = reserved, terminal' = terminal,
    closed' = closed, allowed' = allowed,
  }
  action finish(r: Request): bool = all {
    active.contains(r), active' = active.exclude(Set(r)),
    reserved' = if (terminal.contains(r)) reserved.exclude(Set(r)) else reserved,
    terminal' = terminal.exclude(Set(r)), closed' = closed, allowed' = allowed,
  }
  action respond(r: Request): bool = all {
    reserved.contains(r),
    reserved' = if (active.contains(r)) reserved else reserved.exclude(Set(r)),
    terminal' = if (active.contains(r)) terminal.union(Set(r)) else terminal,
    active' = active, closed' = closed, allowed' = allowed,
  }
  action disconnect(c: int): bool = {
    val owned = reserved.filter(r => r._1 == c)
    all {
      closed' = closed.union(Set(c)),
      reserved' = reserved.exclude(owned.exclude(active)),
      terminal' = terminal.union(owned.intersect(active)),
      active' = active, allowed' = allowed,
    }
  }
  action step = {
    nondet c = CONNECTIONS.oneOf()
    nondet id = IDS.oneOf()
    any { acquire(c, id), start((c, id)), finish((c, id)), respond((c, id)), disconnect(c) }
  }
  val safety = all {
    reserved.size() <= TOTAL,
    CONNECTIONS.forall(c => count(reserved, c) <= PER_CONNECTION),
    active.subseteq(reserved), terminal.subseteq(reserved),
  }
}

module rpc_admission_test {
  import rpc_admission.* from "./rpc-admission"

  run limitsTest = init
    .then(acquire(0, 0)).then(start((0, 0)))
    .then(acquire(0, 1)).then(start((0, 1)))
    .then(acquire(0, 2)).expect(not(allowed))
    .then(acquire(1, 0)).then(start((1, 0)))
    .then(acquire(2, 0)).expect(not(allowed) and safety)

  run disconnectHoldsActiveTest = init
    .then(acquire(0, 0)).then(start((0, 0)))
    .then(acquire(0, 1)).then(start((0, 1)))
    .then(acquire(1, 0)).then(start((1, 0)))
    .then(disconnect(0))
    .then(acquire(2, 0)).expect(not(allowed) and reserved.size() == 3)
    .then(finish((0, 0)))
    .then(acquire(2, 0)).expect(allowed and safety)

  run responseAndFinalizationTest = init
    .then(acquire(0, 0)).then(start((0, 0)))
    .then(respond((0, 0))).expect(reserved.contains((0, 0)))
    .then(finish((0, 0))).expect(reserved.size() == 0)
    .then(acquire(0, 0)).then(start((0, 0)))
    .then(finish((0, 0))).expect(reserved.contains((0, 0)))
    .then(respond((0, 0))).expect(reserved.size() == 0 and safety)
}

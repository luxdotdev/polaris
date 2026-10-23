/**
 * Extensions (ENG-398, ADR 0075 and 0078): Pairings and their Grants, the
 * connections scoped to them by `hello`, the Grant gate in front of every
 * request, and revocation closing live connections.
 *
 * Pairings and connections are small integers; a Grant is a set of names; a
 * request carries what it needs. The real code is `extensions/pairings.ts`,
 * `extensions/connection.ts` and `grants.ts`; the README maps them.
 */
module extensions {
  pure val PAIRINGS = Set(0, 1)
  pure val CONNECTIONS = 0.to(4)
  pure val GRANTS = Set("read", "approve", "turn", "start", "voice")
  /** `-1`: a token-less connection (the Desktop App). */
  pure val NONE = -1

  type Pairing = { grant: Set[str], revoked: bool }
  /** What a request needs: anyone, token-less Clients only, or a Grant. */
  type Need = Open | ClientOnly | Needs(str)
  type Outcome =
    | Nothing
    | HelloOk | HelloRefused
    | Allowed | Refused(str) | NotForExtensions | Dropped
    | RevokeOk | RevokeUnknown

  var pairings: int -> Pairing
  /** Each connection's Pairing (`NONE` for a token-less one). */
  var scoped: int -> int
  var live: int -> bool
  /** What the last action observed, for scenarios and trace replay. */
  var last: Outcome

  // ── grants.ts `decideAccess` ─────────────────────────────────────────────
  pure def decide(p: int, pairings: int -> Pairing, need: Need): Outcome =
    if (p == NONE) Allowed
    else match need {
      | Open => Allowed
      | ClientOnly => NotForExtensions
      | Needs(g) => if (pairings.get(p).grant.contains(g)) Allowed else Refused(g)
    }

  action init = all {
    pairings' = Map(),
    scoped' = CONNECTIONS.mapBy(c => NONE),
    live' = CONNECTIONS.mapBy(c => true),
    last' = Nothing,
  }

  // ── extensions.pair ──────────────────────────────────────────────────────
  action pair(id: int, grant: Set[str]): bool = all {
    not(pairings.keys().contains(id)),
    pairings' = pairings.put(id, { grant: grant, revoked: false }),
    scoped' = scoped, live' = live, last' = Nothing,
  }

  // ── extensions.revoke: the Pairing is revoked and its live connections closed ──
  action revoke(id: int): bool = all {
    if (pairings.keys().contains(id)) all {
      pairings' = pairings.set(id, { ...pairings.get(id), revoked: true }),
      live' = live.keys().mapBy(c => live.get(c) and scoped.get(c) != id),
      scoped' = scoped.keys().mapBy(c => if (scoped.get(c) == id) NONE else scoped.get(c)),
      last' = RevokeOk,
    } else all {
      pairings' = pairings, live' = live, scoped' = scoped, last' = RevokeUnknown,
    }
  }

  // ── hello: a valid token scopes the connection; the first Pairing sticks ──
  action hello(c: int, p: int): bool = all {
    live.get(c),
    pairings' = pairings, live' = live,
    if (p == NONE) all { scoped' = scoped, last' = HelloOk }
    else if (not(pairings.keys().contains(p)) or pairings.get(p).revoked)
      all { scoped' = scoped, last' = HelloRefused }
    else all {
      scoped' = scoped.set(c, if (scoped.get(c) == NONE) p else scoped.get(c)),
      last' = HelloOk,
    }
  }

  // ── any other RPC or Command through the Grant gate ──────────────────────
  action call(c: int, need: Need): bool = all {
    pairings' = pairings, live' = live, scoped' = scoped,
    last' = if (live.get(c)) decide(scoped.get(c), pairings, need) else Dropped,
  }

  action close(c: int): bool = all {
    pairings' = pairings,
    live' = live.set(c, false),
    scoped' = scoped.set(c, NONE),
    last' = Nothing,
  }

  action step = {
    nondet c = CONNECTIONS.oneOf()
    nondet p = PAIRINGS.oneOf()
    nondet grant = GRANTS.powerset().oneOf()
    nondet g = GRANTS.oneOf()
    nondet need = Set(Open, ClientOnly, Needs(g)).oneOf()
    any {
      pair(p, grant),
      revoke(p),
      hello(c, p),
      hello(c, NONE),
      call(c, need),
      close(c),
    }
  }

  // ── Safety ───────────────────────────────────────────────────────────────
  /** A connection acting as a revoked Pairing is never live: revoking cut it off. */
  val revokedHaveNoConnections = CONNECTIONS.forall(c =>
    scoped.get(c) != NONE implies (pairings.keys().contains(scoped.get(c)) and not(pairings.get(scoped.get(c)).revoked)))
  /** A refusal names a Grant the Pairing lacks; what is kept for Clients names none. */
  val refusalsNameAMissingGrant = CONNECTIONS.forall(c =>
    GRANTS.forall(g => (scoped.get(c) != NONE and live.get(c) and decide(scoped.get(c), pairings, Needs(g)) == Refused(g))
      implies not(pairings.get(scoped.get(c)).grant.contains(g))))
  /** A token-less connection is never refused. */
  val clientsKeepFullPower = CONNECTIONS.forall(c =>
    (live.get(c) and scoped.get(c) == NONE) implies GRANTS.forall(g => decide(scoped.get(c), pairings, Needs(g)) == Allowed))
  val safety = all { revokedHaveNoConnections, refusalsNameAMissingGrant, clientsKeepFullPower }

  val witnessScoped = CONNECTIONS.exists(c => scoped.get(c) != NONE)
  val witnessRefused = match last { | Refused(_) => true | _ => false }
  val witnessRevokedClosed = last == RevokeOk and CONNECTIONS.exists(c => not(live.get(c)))
}

module extensions_test {
  import extensions.* from "./extensions"

  run refusedWithoutGrantTest = init
    .then(pair(0, Set("read")))
    .then(hello(0, 0)).expect(last == HelloOk and scoped.get(0) == 0)
    .then(call(0, Needs("read"))).expect(last == Allowed)
    .then(call(0, Needs("turn"))).expect(last == Refused("turn"))
    .then(call(0, ClientOnly)).expect(last == NotForExtensions)
    .then(call(0, Open)).expect(last == Allowed and safety)

  run tokenlessKeepsFullPowerTest = init
    .then(pair(0, Set()))
    .then(hello(1, NONE)).expect(last == HelloOk)
    .then(call(1, ClientOnly)).expect(last == Allowed)
    .then(call(1, Needs("approve"))).expect(last == Allowed and safety)

  run revokeClosesAndRefusesTest = init
    .then(pair(0, Set("read", "approve")))
    .then(pair(1, Set("read")))
    .then(hello(0, 0))
    .then(hello(1, 0))
    .then(hello(2, 1))
    .then(revoke(0)).expect(last == RevokeOk and not(live.get(0)) and not(live.get(1)) and live.get(2))
    .then(call(0, Needs("read"))).expect(last == Dropped)
    .then(call(2, Needs("read"))).expect(last == Allowed)
    .then(hello(2, 0)).expect(last == HelloRefused and scoped.get(2) == 1)
    .then(revoke(0)).expect(last == RevokeOk)
    .then(revoke(5)).expect(last == RevokeUnknown and safety)

  run firstPairingSticksTest = init
    .then(pair(0, Set("read")))
    .then(pair(1, Set("turn")))
    .then(hello(0, 0))
    .then(hello(0, 1)).expect(last == HelloOk and scoped.get(0) == 0)
    .then(hello(0, NONE)).expect(scoped.get(0) == 0)
    .then(call(0, Needs("turn"))).expect(last == Refused("turn"))
    .then(close(0))
    .then(call(0, Needs("read"))).expect(last == Dropped and safety)
}

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
  pure val CONNECTIONS = 0.to(5)
  pure val GRANTS = Set("read", "approve", "turn", "start", "voice")
  /** `-1`: a token-less connection (the Desktop App). */
  pure val NONE = -1
  pure val UNBOUND = -2
  pure val AUTHENTICATING = -3

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
  /** Token checks can yield; calls during that interval have no authority. */
  var pending: int -> int
  /** The gateway opts in before accepting requests. */
  var required: Set[int]
  /** What the last action observed, for scenarios and trace replay. */
  var mode: str
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
    scoped' = CONNECTIONS.mapBy(c => UNBOUND),
    live' = CONNECTIONS.mapBy(c => true),
    pending' = Map(), required' = Set(), mode' = "supervised",
    last' = Nothing,
  }

  // ── extensions.pair ──────────────────────────────────────────────────────
  action pair(id: int, grant: Set[str]): bool = all {
    not(pairings.keys().contains(id)),
    pairings' = pairings.put(id, { grant: grant, revoked: false }),
    scoped' = scoped, live' = live, last' = Nothing,
    pending' = pending, required' = required, mode' = mode,
  }

  // ── extensions.revoke: the Pairing is revoked and its live connections closed ──
  action revoke(id: int): bool = all {
    pending' = pending, required' = required, mode' = mode,
    if (pairings.keys().contains(id)) all {
      pairings' = pairings.set(id, { ...pairings.get(id), revoked: true }),
      live' = live.keys().mapBy(c => live.get(c) and scoped.get(c) != id),
      scoped' = scoped.keys().mapBy(c => if (scoped.get(c) == id) NONE else scoped.get(c)),
      last' = RevokeOk,
    } else all {
      pairings' = pairings, live' = live, scoped' = scoped, last' = RevokeUnknown,
    }
  }

  def valid(p: int): bool = pairings.keys().contains(p) and not(pairings.get(p).revoked)
  def refuseHello(c: int, p: int): bool =
    if (p == NONE) required.contains(c) and scoped.get(c) == UNBOUND
    else not(valid(p)) or scoped.get(c) == NONE or (scoped.get(c) >= 0 and scoped.get(c) != p)

  // ── hello: the first role sticks; every bad token seals and closes it ──
  action hello(c: int, p: int): bool = all {
    live.get(c), not(pending.keys().contains(c)),
    pairings' = pairings, pending' = pending, required' = required, mode' = mode,
    if (refuseHello(c, p)) all {
      scoped' = scoped.set(c, NONE), live' = live.set(c, false), last' = HelloRefused,
    }
    else all {
      scoped' = scoped.set(c, if (scoped.get(c) == UNBOUND) p else scoped.get(c)),
      live' = live, last' = HelloOk,
    }
  }

  action requireToken(c: int): bool = all {
    scoped.get(c) == UNBOUND, live.get(c),
    required' = required.union(Set(c)), mode' = mode, pairings' = pairings, scoped' = scoped,
    live' = live, pending' = pending, last' = Nothing,
  }

  action beginHello(c: int, p: int): bool = all {
    live.get(c), scoped.get(c) == UNBOUND, p != NONE,
    scoped' = scoped.set(c, AUTHENTICATING), pending' = pending.put(c, p),
    pairings' = pairings, live' = live, required' = required, mode' = mode, last' = Nothing,
  }

  action finishHello(c: int): bool = all {
    live.get(c), pending.keys().contains(c),
    val p = pending.get(c)
    all {
      scoped' = scoped.set(c, if (valid(p)) p else NONE),
      live' = live.set(c, valid(p)), last' = if (valid(p)) HelloOk else HelloRefused,
      pairings' = pairings, pending' = pending.keys().exclude(Set(c)).mapBy(k => pending.get(k)), required' = required, mode' = mode,
    }
  }

  // ── any other RPC or Command through the Grant gate ──────────────────────
  action call(c: int, need: Need): bool = all {
    pairings' = pairings, pending' = pending, required' = required, mode' = mode,
    val missing = live.get(c) and scoped.get(c) == UNBOUND and required.contains(c)
    all {
      live' = if (missing) live.set(c, false) else live,
      scoped' = if (live.get(c) and scoped.get(c) == UNBOUND) scoped.set(c, NONE) else scoped,
      last' = if (not(live.get(c))) Dropped
        else if (missing or scoped.get(c) == AUTHENTICATING) NotForExtensions
        else decide(if (scoped.get(c) == UNBOUND) NONE else scoped.get(c), pairings, need),
    }
  }

  action close(c: int): bool = all {
    pairings' = pairings,
    live' = live.set(c, false),
    scoped' = scoped.set(c, NONE),
    last' = Nothing,
    pending' = pending.keys().exclude(Set(c)).mapBy(k => pending.get(k)), required' = required, mode' = mode,
  }

  /** The current Session mode, read inside the serialized commit decision. */
  action setMode(newMode: str): bool = all {
    mode' = newMode, pairings' = pairings, scoped' = scoped, live' = live,
    pending' = pending, required' = required, last' = Nothing,
  }

  action callTurn(c: int): bool = {
    val p = scoped.get(c)
    val approves = p >= 0 and pairings.get(p).grant.contains("turn") and mode != "supervised"
    call(c, Needs(if (approves) "approve" else "turn"))
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
      beginHello(c, p),
      finishHello(c),
      requireToken(c),
      call(c, need),
      callTurn(c),
      setMode("supervised"),
      setMode("auto"),
      setMode("full-access"),
      close(c),
    }
  }

  // ── Safety ───────────────────────────────────────────────────────────────
  /** A connection acting as a revoked Pairing is never live: revoking cut it off. */
  val revokedHaveNoConnections = CONNECTIONS.forall(c =>
    scoped.get(c) >= 0 implies (pairings.keys().contains(scoped.get(c)) and not(pairings.get(scoped.get(c)).revoked)))
  /** A refusal names a Grant the Pairing lacks; what is kept for Clients names none. */
  val refusalsNameAMissingGrant = CONNECTIONS.forall(c =>
    GRANTS.forall(g => (scoped.get(c) >= 0 and live.get(c) and decide(scoped.get(c), pairings, Needs(g)) == Refused(g))
      implies not(pairings.get(scoped.get(c)).grant.contains(g))))
  /** A token-less connection is never refused. */
  val clientsKeepFullPower = CONNECTIONS.forall(c =>
    (live.get(c) and scoped.get(c) == NONE) implies GRANTS.forall(g => decide(scoped.get(c), pairings, Needs(g)) == Allowed))
  val safety = all { revokedHaveNoConnections, refusalsNameAMissingGrant, clientsKeepFullPower }

  val witnessScoped = CONNECTIONS.exists(c => scoped.get(c) >= 0)
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
    .then(hello(2, 0)).expect(last == HelloRefused and not(live.get(2)))
    .then(revoke(0)).expect(last == RevokeOk)
    .then(revoke(5)).expect(last == RevokeUnknown and safety)

  run firstPairingSticksTest = init
    .then(pair(0, Set("read")))
    .then(pair(1, Set("turn")))
    .then(hello(0, 0))
    .then(hello(0, NONE)).expect(scoped.get(0) == 0)
    .then(call(0, Needs("turn"))).expect(last == Refused("turn"))
    .then(hello(0, 1)).expect(last == HelloRefused and not(live.get(0)))
    .then(call(0, Needs("read"))).expect(last == Dropped and safety)

  run clientCannotBecomeExtensionTest = init
    .then(pair(0, Set("read")))
    .then(call(0, ClientOnly)).expect(last == Allowed)
    .then(hello(0, 0)).expect(last == HelloRefused and not(live.get(0)))
    .then(call(0, ClientOnly)).expect(last == Dropped and safety)

  run invalidTokenCannotBecomeClientTest = init
    .then(hello(0, 0)).expect(last == HelloRefused)
    .then(call(0, ClientOnly)).expect(last == Dropped and safety)

  run pendingHelloHasNoAuthorityTest = init
    .then(pair(0, Set("read")))
    .then(beginHello(0, 0))
    .then(call(0, ClientOnly)).expect(last == NotForExtensions)
    .then(revoke(0))
    .then(finishHello(0)).expect(last == HelloRefused)
    .then(call(0, Needs("read"))).expect(last == Dropped and safety)

  run turnsUseCurrentModeTest = init
    .then(pair(0, Set("turn")))
    .then(pair(1, Set("turn", "approve")))
    .then(hello(0, 0)).then(hello(1, 1))
    .then(callTurn(0)).expect(last == Allowed)
    .then(setMode("auto"))
    .then(callTurn(0)).expect(last == Refused("approve"))
    .then(callTurn(1)).expect(last == Allowed)
    .then(setMode("full-access"))
    .then(callTurn(0)).expect(last == Refused("approve"))
    .then(callTurn(1)).expect(last == Allowed)
    .then(setMode("supervised"))
    .then(callTurn(0)).expect(last == Allowed and safety)

  run gatewayRequiresTokenTest = init
    .then(requireToken(0))
    .then(hello(0, NONE)).expect(last == HelloRefused)
    .then(requireToken(1))
    .then(call(1, ClientOnly)).expect(last == NotForExtensions and not(live.get(1)) and safety)
}

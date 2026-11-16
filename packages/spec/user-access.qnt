/**
 * User access (ENG-700, ENG-927, ADR 0114): the user gate in front of user-only RPCs and Commands
 * for token-less connections, and how a Host enrols several Desktop Apps. Keys are small integers.
 * The real code is `apps/daemon/src/userAccess/`, `transport/userAccess.ts` and the protocol's `userAccess.ts`.
 */
module user_access {
  pure val KEYS = Set(1, 2, 3)
  pure val CONNECTIONS = 0.to(3)
  /** A connection presented no key, or holds none any more. */
  pure val NO_KEY = 0
  /** The real bound is 8 (`MAX_REQUESTS`). */
  pure val MAX_REQUESTS = 2

  /** `Allowed`: which connection, and whether the request was user-only. */
  type Outcome = Nothing | HelloOk(bool) | Allowed((int, bool)) | Refused

  /** The enrolled keys' digests on disk (`~/.polaris/user-access.json`). */
  var stored: Set[int]
  /** The file exists: this Host enrolled its first key, even if none is left in it. */
  var initialised: bool
  /** The enrolled keys the gate decides with: `stored` as of the last `hello`, allow or revoke. */
  var enrolled: Set[int]
  /** The key each connection's first keyed `hello` presented, while it is enrolled or waiting. */
  var bound: int -> int
  /** Keys waiting for a Desktop App that holds user access to allow them. */
  var requests: Set[int]
  /** Ghost: keys enrolled on first use or by a connection that held user access. */
  var vouched: Set[int]
  /** Connections with an admitted user-only request or stream still open. */
  var streams: Set[int]
  var last: Outcome

  def holds(c: int): bool = bound.get(c) != NO_KEY and enrolled.contains(bound.get(c))

  /** `bound` without `k`: a denied or revoked key's connections present nothing any more. */
  def unbound(k: int): int -> int =
    bound.keys().mapBy(c => if (bound.get(c) == k) NO_KEY else bound.get(c))

  /** `streams` once the gate decides with `e` and `b`: one whose connection no longer holds ends. */
  def cut(e: Set[int], b: int -> int): Set[int] =
    streams.filter(c => b.get(c) != NO_KEY and e.contains(b.get(c)))

  action init = all {
    stored' = Set(), enrolled' = Set(), requests' = Set(), vouched' = Set(),
    initialised' = false, streams' = Set(),
    bound' = CONNECTIONS.mapBy(_ => NO_KEY), last' = Nothing,
  }

  // ── hello: the first key a fresh Host sees is enrolled; a later unknown one waits ──
  // An emptied registry (`initialised`, nothing stored) enrols nobody and opens no request.
  action hello(c: int, k: int): bool = {
    val keeps = bound.get(c) != NO_KEY or k == NO_KEY
    val first = not(initialised)
    val known = stored.contains(k)
    val asks = not(first) and not(known) and stored != Set()
      and (requests.contains(k) or requests.size() < MAX_REQUESTS)
    val nextEnrolled = if (first) Set(k) else stored
    val nextBound = if (first or known or asks) bound.set(c, k) else bound
    if (keeps) all {
      stored' = stored, enrolled' = enrolled, bound' = bound, requests' = requests,
      vouched' = vouched, initialised' = initialised, streams' = streams,
      last' = HelloOk(holds(c)),
    } else all {
      stored' = if (first) Set(k) else stored,
      enrolled' = nextEnrolled,
      bound' = nextBound,
      initialised' = true, streams' = cut(nextEnrolled, nextBound),
      requests' = if (first or known) requests.exclude(Set(k))
        else if (asks) requests.union(Set(k)) else requests,
      vouched' = if (first) vouched.union(Set(k)) else vouched,
      last' = HelloOk(first or known),
    }
  }

  // ── a request through the user gate: `user` needs held access, `any` never does ──
  action call(c: int, user: bool): bool = all {
    stored' = stored, enrolled' = enrolled, bound' = bound, requests' = requests,
    vouched' = vouched, initialised' = initialised, streams' = streams,
    last' = if (user and not(holds(c))) Refused else Allowed((c, user)),
  }

  // ── an admitted user-only request or stream stays open (`computerUse.preview.watch`) ──
  action watch(c: int): bool = all {
    holds(c),
    streams' = streams.union(Set(c)),
    stored' = stored, enrolled' = enrolled, bound' = bound, requests' = requests,
    vouched' = vouched, initialised' = initialised, last' = Allowed((c, true)),
  }

  // ── `userAccess.allow`, user-only: the waiting key is enrolled, and its connections hold at once ──
  action allow(c: int, k: int): bool = all {
    holds(c), requests.contains(k),
    stored' = stored.union(Set(k)), enrolled' = stored.union(Set(k)),
    requests' = requests.exclude(Set(k)), vouched' = vouched.union(Set(k)),
    initialised' = true, streams' = cut(stored.union(Set(k)), bound),
    bound' = bound, last' = Nothing,
  }

  // ── `userAccess.deny`, user-only: the request closes; that Desktop App asks again by reconnecting ──
  action deny(c: int, k: int): bool = all {
    holds(c), requests.contains(k),
    requests' = requests.exclude(Set(k)), bound' = unbound(k),
    stored' = stored, enrolled' = enrolled, vouched' = vouched,
    initialised' = initialised, streams' = streams, last' = Nothing,
  }

  // ── `userAccess.revoke`, user-only: the key's connections lose user access at once, and
  // their open user-only requests and streams end. Never the last key: nothing could allow the next ──
  action revoke(c: int, k: int): bool = all {
    holds(c), stored.contains(k), stored.size() > 1,
    stored' = stored.exclude(Set(k)), enrolled' = stored.exclude(Set(k)),
    bound' = unbound(k), requests' = requests, vouched' = vouched,
    initialised' = initialised, streams' = cut(stored.exclude(Set(k)), unbound(k)),
    last' = Nothing,
  }

  // ── the connection closes: its request goes with the last connection that presented the key ──
  action close(c: int): bool = {
    val k = bound.get(c)
    val others = CONNECTIONS.exists(o => o != c and bound.get(o) == k)
    all {
      bound' = bound.set(c, NO_KEY),
      requests' = if (others) requests else requests.exclude(Set(k)),
      streams' = streams.exclude(Set(c)), initialised' = initialised,
      stored' = stored, enrolled' = enrolled, vouched' = vouched, last' = Nothing,
    }
  }

  /** Recovery, by the person at the Host: the enrolment file deleted. Read again on the next `hello`. */
  action forget = all {
    stored' = Set(), initialised' = false, enrolled' = enrolled, bound' = bound,
    requests' = requests, vouched' = vouched, streams' = streams, last' = Nothing,
  }

  /** The file edited to hold no keys: not a fresh Host, so first use does not come back. */
  action emptied = all {
    stored' = Set(), initialised' = true, enrolled' = enrolled, bound' = bound,
    requests' = requests, vouched' = vouched, streams' = streams, last' = Nothing,
  }

  /** The Daemon reads the file again: on a keyed `hello`, an allow, or a revoke it refuses. */
  action reread = all {
    enrolled' = stored, stored' = stored, bound' = bound, requests' = requests,
    vouched' = vouched, initialised' = initialised, streams' = cut(stored, bound),
    last' = Nothing,
  }

  action step = {
    nondet c = CONNECTIONS.oneOf()
    nondet k = KEYS.union(Set(NO_KEY)).oneOf()
    nondet user = Set(true, false).oneOf()
    any {
      hello(c, k), call(c, user), watch(c), allow(c, k), deny(c, k), revoke(c, k), close(c),
      forget, emptied, reread,
    }
  }

  // ── Safety ───────────────────────────────────────────────────────────────
  /** A user-only request is allowed only on a connection that holds user access. */
  val userOnlyNeedsAccess = match last {
    | Allowed(call) => call._2 implies holds(call._1)
    | _ => true
  }
  /** A key is enrolled only on first use or by a connection that held user access: never by itself. */
  val enrolledWereVouched = stored.union(enrolled).subseteq(vouched)
  /** A waiting key is not enrolled, so a connection never both waits and holds. */
  val waitingIsNotEnrolled = requests.intersect(stored.union(enrolled)) == Set()
  /** Every request has an open connection behind it, and they are bounded. */
  val requestsAreLive = requests.size() <= MAX_REQUESTS
    and requests.forall(k => CONNECTIONS.exists(c => bound.get(c) == k))
  /** An open user-only request or stream belongs to a connection that still holds user access. */
  val streamsNeedAccess = streams.forall(c => holds(c))
  /** Only a fresh Host enrols on first use: with the file there, an empty registry stays empty. */
  val enrolledNeedsTheFile = (stored != Set()) implies initialised
  val safety = userOnlyNeedsAccess and enrolledWereVouched and waitingIsNotEnrolled
    and requestsAreLive and streamsNeedAccess and enrolledNeedsTheFile

  val witnessRefused = last == Refused
  val witnessSeveralEnrolled = enrolled.size() < 2
}

module user_access_test {
  import user_access.* from "./user-access"

  run socketOnlyIsRefusedTest = init
    .then(hello(0, 1)).expect(last == HelloOk(true))
    .then(hello(1, NO_KEY)).expect(last == HelloOk(false))
    .then(call(1, true)).expect(last == Refused)
    .then(call(1, false)).expect(last == Allowed((1, false)))
    .then(call(0, true)).expect(last == Allowed((0, true)) and safety)

  run ownKeyWaitsAndCannotAllowItselfTest = init
    .then(hello(0, 1))
    .then(hello(1, 2)).expect(last == HelloOk(false) and requests == Set(2))
    .then(call(1, true)).expect(last == Refused)
    .then(allow(1, 2)).fail()

  run requestBeforeHelloIsRefusedTest = init
    .then(hello(0, 1))
    .then(call(2, true)).expect(last == Refused and safety)

  run allowedHoldsOnTheSameConnectionTest = init
    .then(hello(0, 1))
    .then(hello(1, 2))
    .then(allow(0, 2)).expect(enrolled == Set(1, 2) and requests == Set())
    .then(call(1, true)).expect(last == Allowed((1, true)) and safety)

  run revokeCutsAccessAtOnceTest = init
    .then(hello(0, 1))
    .then(hello(1, 2))
    .then(allow(0, 2))
    .then(watch(1)).expect(streams == Set(1))
    .then(watch(0))
    .then(revoke(0, 2)).expect(streams == Set(0))
    .then(call(1, true)).expect(last == Refused and safety)
    .then(hello(1, 2)).expect(last == HelloOk(false) and requests == Set(2))

  run deniedAsksAgainOnlyByHelloTest = init
    .then(hello(0, 1))
    .then(hello(1, 2))
    .then(deny(0, 2)).expect(requests == Set() and bound.get(1) == NO_KEY)
    .then(call(1, true)).expect(last == Refused and safety)

  run closingDropsTheRequestTest = init
    .then(hello(0, 1))
    .then(hello(1, 2))
    .then(hello(2, 2))
    .then(close(1)).expect(requests == Set(2))
    .then(close(2)).expect(requests == Set() and safety)

  run requestsAreBoundedTest = init
    .then(hello(0, 1))
    .then(hello(1, 2))
    .then(hello(2, 3))
    .then(hello(3, 4)).expect(requests == Set(2, 3) and bound.get(3) == NO_KEY and safety)

  run forgetLetsTheNextKeyEnrolTest = init
    .then(hello(0, 1))
    .then(forget)
    .then(hello(1, 2)).expect(last == HelloOk(true) and enrolled == Set(2))
    .then(call(0, true)).expect(last == Refused)
    .then(hello(2, 1)).expect(last == HelloOk(false) and safety)

  run theLastKeyIsNotRevokedTest = init
    .then(hello(0, 1))
    .then(revoke(0, 1)).fail()

  run emptiedRegistryFailsClosedTest = init
    .then(hello(0, 1))
    .then(emptied)
    .then(hello(1, 2)).expect(last == HelloOk(false) and stored == Set() and requests == Set())
    .then(call(1, true)).expect(last == Refused and safety)

  run deletedFileIsNoticedOnRereadTest = init
    .then(hello(0, 1))
    .then(forget)
    .then(call(0, true)).expect(last == Allowed((0, true)))
    .then(watch(0))
    .then(reread).expect(streams == Set())
    .then(call(0, true)).expect(last == Refused and safety)
}

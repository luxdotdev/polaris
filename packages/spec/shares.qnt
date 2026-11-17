// -*- mode: Bluespec; -*-
/**
 * Shared Sessions (ENG-941, ADR 0112 and 0113): Shares and the gate in front of a Teammate's
 * requests, the Account Server's statement on a Teammate's connection, Comments as events
 * of the shared session's log, sent to the agent by `SendFeedback` with Comment IDs, and
 * approvals: Needs You reaches the Contributors who did not mute the session, and the first
 * answer is recorded with who gave it.
 *
 * People, sessions, Shares and Comments are small integers; time is a counter. The contract is
 * `packages/protocol/src/shares.ts`, `shareGrants.ts` and `comments.ts`; README.md, "Shares and
 * Comments", maps them.
 */
module shares_model {
  /** The gate ignores the Share's target: any live Share admits any session. */
  const BUG_UNSCOPED: bool
  /** `SendFeedback` carries a Comment that an earlier Turn already carried. */
  const BUG_RESEND: bool
  /** A Teammate's Allow is remembered beyond its request (on the Host or in the Harness). */
  const BUG_REMEMBER: bool
  /** Needs You goes to anyone a Share covers, whatever its Grant: a Commenter too. */
  const BUG_COMMENTERS: bool

  /** The owner, on any of their own Clients; never gated by a Share. */
  pure val OWNER = 0
  pure val PEOPLE = Set(1, 2)
  /** Session 0 stands alone; session 1 leads Constellation 0 and session 2 is its Worker. */
  pure val SESSIONS = Set(0, 1, 2)
  pure val WORKER = 2
  pure def constellationOf(session: int): int = if (session == 0) -1 else 0
  pure val SHARE_IDS = Set(0, 1, 2)
  pure val COMMENT_IDS = Set(0, 1, 2)
  pure val APPROVAL_IDS = Set(0, 1)
  /** `SHARE_DEFAULT_LIFETIME_MS` (7 days) and `SHARE_MAX_LIFETIME_MS` (30 days), in ticks. */
  pure val DEFAULT_LIFETIME = 2
  pure val MAX_LIFETIME = 4
  /** `STATEMENT_LIFETIME_S` (15 minutes): a statement not refreshed lapses at the next tick. */
  pure val STATEMENT_LIFETIME = 1
  /** `SHARE_ROLE_GRANTS`. */
  pure def grantOf(role: str): Set[str] =
    if (role == "contributor") Set("read", "comment", "approve", "turn", "start", "voice")
    else Set("read", "comment")

  type Target = SessionT(int) | ConstellationT(int)
  type Share = {
    person: int, target: Target, role: str, grant: Set[str],
    since: int, expires: int, revoked: bool,
  }
  /** `sentIn`: the index of the Turn that carried it, -1 until sent. */
  type Comment = { session: int, author: int, body: int, resolved: bool, sentIn: int }
  type Turn = { session: int, actor: int, carried: Set[int] }
  type Outcome = Nothing | Allowed | NotShared | NotGranted(str) | Rejected | StatementRejected
  type Request = { by: int, session: int, need: str }
  /** `by`: who answered it first, -1 while pending; `remembered`: an Allow that outlives it. */
  type Approval = { session: int, by: int, remembered: bool }
  /** One person's mute of a shared target (`shares.mute`). */
  type Mute = { person: int, target: Target }

  type State = {
    now: int,
    shares: int -> Share,
    /** Each connected Teammate's statement expiry; a person without one has no connection. */
    statements: int -> int,
    comments: int -> Comment,
    turns: List[Turn],
    approvals: int -> Approval,
    mutes: Set[Mute],
    last: Outcome,
    // Ghosts: the gated request `last` answered, and who added each Comment.
    request: Request,
    authored: int -> int,
    // Ghosts: who the last Needs You went to, and the session it was about.
    pushed: Set[int],
    pushedAbout: int,
  }
  var s: State

  // ── shares.ts `isShareLive`, shareGrants.ts `shareCovers` and `decideShareAccess` ──
  pure def live(share: Share, now: int): bool = not(share.revoked) and share.expires > now
  pure def covers(target: Target, session: int): bool = match target {
    | SessionT(t) => t == session
    | ConstellationT(c) => constellationOf(session) == c
  }
  pure def hasLive(shares: int -> Share, person: int, now: int): bool =
    shares.keys().exists(id => shares.get(id).person == person and live(shares.get(id), now))
  def covering(by: int, session: int): Set[int] = s.shares.keys().filter(id =>
    s.shares.get(id).person == by and live(s.shares.get(id), s.now)
      and (BUG_UNSCOPED or covers(s.shares.get(id).target, session)))
  /** `need` is a Grant, or `contributor` for what no Grant names (`SetModel`, `AcceptTurns`…). */
  pure def holds(share: Share, need: str): bool =
    if (need == "contributor") share.role == "contributor" else share.grant.contains(need)
  def decide(by: int, session: int, need: str): Outcome =
    if (by == OWNER) Allowed
    else if (covering(by, session) == Set()) NotShared
    else if (covering(by, session).exists(id => holds(s.shares.get(id), need))) Allowed
    else if (need == "contributor") NotShared
    else NotGranted(need)
  /** The owner always acts; a Teammate only over a connection with a statement. */
  def present(by: int): bool = by == OWNER or s.statements.keys().contains(by)
  /** Connections that survive: an unexpired statement, and a live Share for its person. */
  pure def admitted(statements: int -> int, shares: int -> Share, now: int): int -> int =
    statements.keys().filter(p => statements.get(p) > now and hasLive(shares, p, now))
      .mapBy(p => statements.get(p))

  // ── shares/notifications.ts `teammatesFor` and `isMuted` ─────────────────
  /** A live Share of `person` covers `session`, holding `approve` unless `anyGrant`. */
  def covered(person: int, session: int, anyGrant: bool): bool = s.shares.keys().exists(id => all {
    s.shares.get(id).person == person,
    live(s.shares.get(id), s.now),
    covers(s.shares.get(id).target, session),
    anyGrant or s.shares.get(id).grant.contains("approve"),
  })
  def approves(person: int, session: int): bool = covered(person, session, false)
  def muted(person: int, session: int): bool =
    s.mutes.exists(m => m.person == person and covers(m.target, session))
  /** The owner's devices, and every Contributor's covering the session, less those who muted it. */
  def needsYou(session: int): Set[int] =
    PEOPLE.filter(p => covered(p, session, BUG_COMMENTERS)).union(Set(OWNER)).filter(p => not(muted(p, session)))
  /** The session a target's gate decides on: a Constellation's through its Lead. */
  pure def gatedOn(target: Target): int = match target { | SessionT(t) => t | ConstellationT(_) => 1 }

  action init = s' = {
    now: 0, shares: Map(), statements: Map(), comments: Map(), turns: [],
    approvals: Map(), mutes: Set(),
    last: Nothing, request: { by: OWNER, session: 0, need: "" }, authored: Map(),
    pushed: Set(), pushedAbout: 0,
  }

  // ── shares.create: never a Worker's session, never past the maximum ──────
  action createShare(id: int, person: int, target: Target, role: str, lifetime: int): bool = {
    val worker = match target { | SessionT(t) => t == WORKER | ConstellationT(_) => false }
    val ok = not(worker) and lifetime > 0 and lifetime <= MAX_LIFETIME
    val share = {
      person: person, target: target, role: role, grant: grantOf(role),
      since: s.now, expires: s.now + lifetime, revoked: false,
    }
    all {
      not(s.shares.keys().contains(id)),
      s' = if (ok) { ...s, pushed: Set(), shares: s.shares.put(id, share), last: Nothing }
        else { ...s, pushed: Set(), last: Rejected },
    }
  }

  // ── shares.renew: a live or expired Share, from now ──────────────────────
  action renewShare(id: int, lifetime: int): bool = {
    val ok = not(s.shares.get(id).revoked) and lifetime > 0 and lifetime <= MAX_LIFETIME
    val renewed = { ...s.shares.get(id), since: s.now, expires: s.now + lifetime }
    all {
      s.shares.keys().contains(id),
      s' = if (ok) { ...s, pushed: Set(), shares: s.shares.set(id, renewed), last: Nothing }
        else { ...s, pushed: Set(), last: Rejected },
    }
  }

  // ── shares.revoke: the person's connection closes at once ────────────────
  action revokeShare(id: int): bool = {
    val shares = s.shares.set(id, { ...s.shares.get(id), revoked: true })
    all {
      s.shares.keys().contains(id),
      s' = { ...s, pushed: Set(), shares: shares, statements: admitted(s.statements, shares, s.now), last: Nothing },
    }
  }

  /** Time passes: Shares expire, and statements that were not refreshed lapse. */
  action tick = s' = {
    ...s, now: s.now + 1, statements: admitted(s.statements, s.shares, s.now + 1), last: Nothing,
    pushed: Set(),
  }

  // ── hello with `accountStatement`; `vouched`: the issuer's keys verify it ──
  action hello(person: int, vouched: bool): bool = {
    val ok = vouched and hasLive(s.shares, person, s.now)
    val without = s.statements.keys().exclude(Set(person)).mapBy(p => s.statements.get(p))
    s' = if (ok) { ...s, pushed: Set(), statements: s.statements.put(person, s.now + STATEMENT_LIFETIME), last: Nothing }
      else { ...s, pushed: Set(), statements: without, last: StatementRejected }
  }

  // ── account.refreshStatement: a refused one leaves the old statement to lapse ──
  action refresh(person: int, vouched: bool): bool = all {
    s.statements.keys().contains(person),
    s' = if (vouched) { ...s, pushed: Set(), statements: s.statements.set(person, s.now + STATEMENT_LIFETIME), last: Nothing }
      else { ...s, pushed: Set(), last: StatementRejected },
  }

  // ── any RPC or Command of the Teammate allowlist, touching `session` ─────
  action call(by: int, session: int, need: str): bool = all {
    present(by),
    s' = { ...s, pushed: Set(), last: decide(by, session, need), request: { by: by, session: session, need: need } },
  }

  // ── AddComment → CommentAdded ────────────────────────────────────────────
  action addComment(by: int, session: int, id: int): bool = {
    val gate = decide(by, session, "comment")
    val comment = { session: session, author: by, body: 0, resolved: false, sentIn: -1 }
    val asked = { by: by, session: session, need: "comment" }
    all {
      present(by), not(s.comments.keys().contains(id)),
      s' = if (gate == Allowed) {
        ...s, comments: s.comments.put(id, comment), authored: s.authored.put(id, by),
        last: Allowed, request: asked, pushed: Set(),
      } else { ...s, pushed: Set(), last: gate, request: asked },
    }
  }

  // ── EditComment → CommentEdited: its author only, until it is sent ───────
  action editComment(by: int, id: int): bool = {
    val comment = s.comments.get(id)
    val gate = decide(by, comment.session, "comment")
    val ok = gate == Allowed and comment.author == by and comment.sentIn == -1
    all {
      present(by), s.comments.keys().contains(id),
      s' = {
        ...s,
        pushed: Set(),
        comments: if (ok) s.comments.set(id, { ...comment, body: comment.body + 1 }) else s.comments,
        last: if (gate != Allowed) gate else if (ok) Allowed else Rejected,
        request: { by: by, session: comment.session, need: "comment" },
      },
    }
  }

  // ── ResolveComment / ReopenComment: comments.ts `mayResolveComment` ──────
  action setResolved(by: int, id: int, resolved: bool): bool = {
    val comment = s.comments.get(id)
    val gate = decide(by, comment.session, "comment")
    val may = by == OWNER or comment.author == by
      or covering(by, comment.session).exists(share => s.shares.get(share).role == "contributor")
    val ok = gate == Allowed and may and comment.resolved != resolved
    all {
      present(by), s.comments.keys().contains(id),
      s' = {
        ...s,
        pushed: Set(),
        comments: if (ok) s.comments.set(id, { ...comment, resolved: resolved }) else s.comments,
        last: if (gate != Allowed) gate else if (ok) Allowed else Rejected,
        request: { by: by, session: comment.session, need: "comment" },
      },
    }
  }

  // ── SendFeedback with Comment IDs → TurnStarted, one Turn whose Actor is the sender ──
  action sendFeedback(by: int, session: int, ids: Set[int]): bool = {
    val gate = decide(by, session, "turn")
    val known = ids.forall(id => s.comments.keys().contains(id) and s.comments.get(id).session == session)
    val ok = gate == Allowed and known
      and (BUG_RESEND or ids.forall(id => s.comments.get(id).sentIn == -1))
    val index = s.turns.length()
    all {
      present(by),
      s' = {
        ...s,
        pushed: Set(),
        turns: if (ok) s.turns.append({ session: session, actor: by, carried: ids }) else s.turns,
        comments: if (ok) s.comments.keys().mapBy(id =>
          if (ids.contains(id)) { ...s.comments.get(id), sentIn: index } else s.comments.get(id))
          else s.comments,
        last: if (gate != Allowed) gate else if (ok) Allowed else Rejected,
        request: { by: by, session: session, need: "turn" },
      },
    }
  }

  // ── ApprovalRequested: the owner's pushes and the Contributors' (`push/notifier.ts` `fanOut`) ──
  action requestApproval(id: int, session: int): bool = all {
    not(s.approvals.keys().contains(id)),
    s' = {
      ...s,
      approvals: s.approvals.put(id, { session: session, by: -1, remembered: false }),
      pushed: needsYou(session), pushedAbout: session, last: Nothing,
    },
  }

  // ── RespondToApproval → ApprovalResolved with the Actor; the first answer wins ──
  action respond(by: int, id: int, remember: bool): bool = {
    val approval = s.approvals.get(id)
    val gate = decide(by, approval.session, "approve")
    val ok = gate == Allowed and approval.by == -1
      and (by == OWNER or not(remember) or BUG_REMEMBER)
    all {
      present(by), s.approvals.keys().contains(id),
      s' = {
        ...s,
        pushed: Set(),
        approvals: if (ok) s.approvals.set(id, { ...approval, by: by, remembered: remember })
          else s.approvals,
        last: if (gate != Allowed) gate else if (ok) Allowed else Rejected,
        request: { by: by, session: approval.session, need: "approve" },
      },
    }
  }

  // ── shares.mute: each person's own, for what their Share lets them read ──
  action mute(by: int, target: Target, on: bool): bool = {
    val gate = decide(by, gatedOn(target), "read")
    val mine = { person: by, target: target }
    all {
      present(by),
      s' = {
        ...s,
        pushed: Set(),
        mutes: if (gate != Allowed) s.mutes else if (on) s.mutes.union(Set(mine))
          else s.mutes.exclude(Set(mine)),
        last: gate,
        request: { by: by, session: gatedOn(target), need: "read" },
      },
    }
  }

  action step = {
    nondet id = SHARE_IDS.oneOf()
    nondet person = PEOPLE.oneOf()
    nondet by = PEOPLE.union(Set(OWNER)).oneOf()
    nondet session = SESSIONS.oneOf()
    nondet target = Set(SessionT(0), SessionT(1), SessionT(2), ConstellationT(0)).oneOf()
    nondet role = Set("contributor", "commenter").oneOf()
    nondet lifetime = 1.to(MAX_LIFETIME + 1).oneOf()
    nondet vouched = Set(true, false).oneOf()
    nondet need = Set("read", "comment", "approve", "turn", "start", "contributor").oneOf()
    nondet comment = COMMENT_IDS.oneOf()
    nondet ids = COMMENT_IDS.powerset().oneOf()
    nondet resolved = Set(true, false).oneOf()
    nondet approval = APPROVAL_IDS.oneOf()
    any {
      createShare(id, person, target, role, lifetime),
      renewShare(id, lifetime),
      revokeShare(id),
      tick,
      hello(person, vouched),
      refresh(person, vouched),
      call(by, session, need),
      addComment(by, session, comment),
      editComment(by, comment),
      setResolved(by, comment, resolved),
      sendFeedback(by, session, ids),
      requestApproval(approval, session),
      respond(by, approval, resolved),
      mute(by, target, resolved),
    }
  }

  // ── Safety ───────────────────────────────────────────────────────────────
  /** An allowed Teammate request touched a live Share's target, and that Share held its Grant. */
  val teammatesStayInShare = (s.last == Allowed and s.request.by != OWNER) implies
    s.shares.keys().exists(id => all {
      s.shares.get(id).person == s.request.by,
      live(s.shares.get(id), s.now),
      covers(s.shares.get(id).target, s.request.session),
      holds(s.shares.get(id), s.request.need),
    })
  /** A Teammate's connection has an unexpired statement and a live Share for its person. */
  val connectionsAreVouched = s.statements.keys().forall(p =>
    s.statements.get(p) > s.now and hasLive(s.shares, p, s.now))
  /** A Worker's session is never a target, and no Share outlasts the maximum. */
  val sharesAreBounded = s.shares.keys().forall(id => all {
    s.shares.get(id).target != SessionT(WORKER),
    s.shares.get(id).expires - s.shares.get(id).since <= MAX_LIFETIME,
  })
  /** A Comment keeps its author, whoever edits, resolves or sends it. */
  val commentsKeepAuthor = s.comments.keys().forall(id =>
    s.comments.get(id).author == s.authored.get(id))
  /** A Comment is carried by at most one Turn, of its own session, and says which. */
  val sentWithOneTurn = s.comments.keys().forall(id =>
    s.turns.indices().forall(i => s.turns[i].carried.contains(id) iff s.comments.get(id).sentIn == i))
    and s.turns.indices().forall(i => s.turns[i].carried.forall(id =>
      s.comments.keys().contains(id) and s.comments.get(id).session == s.turns[i].session))
  /** Only the owner's Allow outlives its request. */
  val onlyTheOwnerRemembers = s.approvals.keys().forall(id =>
    s.approvals.get(id).remembered implies s.approvals.get(id).by == OWNER)
  /** A Needs You reaches only the owner and Contributors, and nobody who muted its session. */
  val needsYouStaysInShare = s.pushed.forall(p =>
    (p == OWNER or approves(p, s.pushedAbout)) and not(muted(p, s.pushedAbout)))
  val safety = all {
    teammatesStayInShare, connectionsAreVouched, sharesAreBounded, commentsKeepAuthor,
    sentWithOneTurn, onlyTheOwnerRemembers, needsYouStaysInShare,
  }

  val witnessOutside = s.last == NotShared and s.statements.keys().contains(s.request.by)
  val witnessNotGranted = match s.last { | NotGranted(_) => true | _ => false }
  val witnessSentByAnother = s.turns.indices().exists(i =>
    s.turns[i].carried.exists(id => s.comments.get(id).author != s.turns[i].actor))
  val witnessTeammateTurn = s.turns.indices().exists(i => s.turns[i].actor != OWNER)
  val witnessTeammateAnswered = s.approvals.keys().exists(id =>
    s.approvals.get(id).by != OWNER and s.approvals.get(id).by != -1)
  val witnessTeammateNeedsYou = s.pushed.exists(p => p != OWNER)
}

module shares {
  import shares_model(BUG_UNSCOPED=false, BUG_RESEND=false, BUG_REMEMBER=false, BUG_COMMENTERS=false).*

  run outsideTheTargetIsRefusedTest = init
    .then(createShare(0, 1, SessionT(0), "contributor", DEFAULT_LIFETIME))
    .then(hello(1, true))
    .then(call(1, 0, "turn")).expect(s.last == Allowed)
    .then(call(1, 0, "contributor")).expect(s.last == Allowed)
    .then(call(1, 1, "contributor")).expect(s.last == NotShared)
    .then(call(1, 1, "read")).expect(s.last == NotShared)
    .then(sendFeedback(1, 1, Set())).expect(s.last == NotShared and s.turns.length() == 0 and safety)

  run constellationCoversItsWorkersTest = init
    .then(createShare(0, 1, ConstellationT(0), "contributor", DEFAULT_LIFETIME))
    .then(hello(1, true))
    .then(call(1, 1, "turn")).expect(s.last == Allowed)
    .then(call(1, WORKER, "approve")).expect(s.last == Allowed)
    .then(call(1, 0, "read")).expect(s.last == NotShared)
    .then(createShare(1, 2, SessionT(WORKER), "commenter", DEFAULT_LIFETIME))
    .expect(s.last == Rejected and not(s.shares.keys().contains(1)) and safety)

  run commenterCommentsAndAnotherSendsTest = init
    .then(createShare(0, 1, SessionT(0), "commenter", DEFAULT_LIFETIME))
    .then(hello(1, true))
    .then(addComment(1, 0, 0)).expect(s.last == Allowed)
    .then(call(1, 0, "turn")).expect(s.last == NotGranted("turn"))
    .then(call(1, 0, "contributor")).expect(s.last == NotShared)
    .then(sendFeedback(1, 0, Set(0))).expect(s.last == NotGranted("turn") and s.turns.length() == 0)
    .then(sendFeedback(OWNER, 0, Set(0))).expect(s.last == Allowed)
    .expect(s.turns[0].actor == OWNER and s.comments.get(0).author == 1 and s.comments.get(0).sentIn == 0)
    .then(editComment(1, 0)).expect(s.last == Rejected)
    .then(sendFeedback(OWNER, 0, Set(0))).expect(s.last == Rejected and s.turns.length() == 1)
    .then(sendFeedback(OWNER, 0, Set(1))).expect(s.last == Rejected and safety)

  run authorOwnerOrContributorResolvesTest = init
    .then(createShare(0, 1, SessionT(0), "commenter", DEFAULT_LIFETIME))
    .then(createShare(1, 2, SessionT(0), "commenter", DEFAULT_LIFETIME))
    .then(hello(1, true)).then(hello(2, true))
    .then(addComment(1, 0, 0))
    .then(setResolved(2, 0, true)).expect(s.last == Rejected and not(s.comments.get(0).resolved))
    .then(editComment(2, 0)).expect(s.last == Rejected and s.comments.get(0).body == 0)
    .then(setResolved(1, 0, true)).expect(s.last == Allowed and s.comments.get(0).resolved)
    .then(setResolved(OWNER, 0, false)).expect(s.last == Allowed and not(s.comments.get(0).resolved))
    .then(createShare(2, 2, SessionT(0), "contributor", DEFAULT_LIFETIME))
    .then(setResolved(2, 0, true)).expect(s.last == Allowed and safety)

  run expiryRenewalAndRevocationTest = init
    .then(createShare(0, 1, SessionT(0), "contributor", MAX_LIFETIME + 1)).expect(s.last == Rejected)
    .then(createShare(0, 1, SessionT(0), "contributor", DEFAULT_LIFETIME))
    .then(hello(1, true))
    .then(tick).expect(not(s.statements.keys().contains(1)))
    .then(hello(1, false)).expect(s.last == StatementRejected)
    .then(hello(1, true)).then(refresh(1, true))
    .then(tick).expect(not(s.statements.keys().contains(1)))
    .then(hello(1, true)).expect(s.last == StatementRejected)
    .then(renewShare(0, DEFAULT_LIFETIME))
    .then(hello(1, true)).then(call(1, 0, "read")).expect(s.last == Allowed)
    .then(revokeShare(0)).expect(not(s.statements.keys().contains(1)))
    .then(hello(1, true)).expect(s.last == StatementRejected)
    .then(renewShare(0, DEFAULT_LIFETIME)).expect(s.last == Rejected and safety)

  run contributorAnswersFirstTest = init
    .then(createShare(0, 1, SessionT(0), "contributor", DEFAULT_LIFETIME))
    .then(hello(1, true))
    .then(requestApproval(0, 0)).expect(s.pushed == Set(OWNER, 1))
    .then(respond(1, 0, true)).expect(s.last == Rejected and s.approvals.get(0).by == -1)
    .then(respond(1, 0, false)).expect(s.last == Allowed and s.approvals.get(0).by == 1)
    .then(respond(OWNER, 0, false)).expect(s.last == Rejected and s.approvals.get(0).by == 1)
    .then(requestApproval(1, 0))
    .then(respond(OWNER, 1, true)).expect(s.approvals.get(1).remembered and safety)

  run commenterIsNotAskedTest = init
    .then(createShare(0, 1, SessionT(0), "commenter", DEFAULT_LIFETIME))
    .then(hello(1, true))
    .then(requestApproval(0, 0)).expect(s.pushed == Set(OWNER))
    .then(respond(1, 0, false)).expect(s.last == NotGranted("approve") and s.approvals.get(0).by == -1)
    .then(revokeShare(0))
    .then(createShare(1, 2, SessionT(0), "contributor", DEFAULT_LIFETIME))
    .then(requestApproval(1, 0)).expect(s.pushed == Set(OWNER, 2) and safety)

  run eachPersonMutesForThemselvesTest = init
    .then(createShare(0, 1, ConstellationT(0), "contributor", DEFAULT_LIFETIME))
    .then(createShare(1, 2, SessionT(0), "contributor", DEFAULT_LIFETIME))
    .then(hello(1, true)).then(hello(2, true))
    .then(mute(1, ConstellationT(0), true)).expect(s.last == Allowed)
    .then(requestApproval(0, WORKER)).expect(s.pushed == Set(OWNER))
    .then(mute(2, ConstellationT(0), true)).expect(s.last == NotShared)
    .then(mute(OWNER, SessionT(0), true))
    .then(requestApproval(1, 0)).expect(s.pushed == Set(2))
    // Muted or not, a Contributor still answers: the app shows the Needs You.
    .then(respond(1, 0, false)).expect(s.last == Allowed and s.approvals.get(0).by == 1)
    .then(mute(1, ConstellationT(0), false))
    .then(requestApproval(2, WORKER)).expect(s.pushed == Set(OWNER, 1) and safety)

  run leadActionsAreAContributorsTest = init
    .then(createShare(0, 1, ConstellationT(0), "contributor", DEFAULT_LIFETIME))
    .then(createShare(1, 2, ConstellationT(0), "commenter", DEFAULT_LIFETIME))
    .then(hello(1, true)).then(hello(2, true))
    .then(call(1, 1, "start")).expect(s.last == Allowed)
    .then(call(1, WORKER, "approve")).expect(s.last == Allowed)
    .then(call(2, 1, "start")).expect(s.last == NotGranted("start") and safety)

  run refusedRefreshLapsesTest = init
    .then(createShare(0, 1, SessionT(0), "contributor", MAX_LIFETIME))
    .then(hello(1, true))
    .then(refresh(1, false)).expect(s.last == StatementRejected and s.statements.keys().contains(1))
    .then(tick).expect(not(s.statements.keys().contains(1)) and safety)
}

/** The gate before Share-scoped admission: a Share of one session admits another. */
module shares_unscoped_mutant {
  import shares_model(BUG_UNSCOPED=true, BUG_RESEND=false, BUG_REMEMBER=false, BUG_COMMENTERS=false).*

  run reachesAnotherSessionTest = init
    .then(createShare(0, 1, SessionT(0), "contributor", DEFAULT_LIFETIME))
    .then(hello(1, true))
    .then(call(1, 1, "turn")).expect(s.last == Allowed and not(safety))
}

/** `SendFeedback` without the already-sent refusal: two Turns carry one Comment. */
module shares_resend_mutant {
  import shares_model(BUG_UNSCOPED=false, BUG_RESEND=true, BUG_REMEMBER=false, BUG_COMMENTERS=false).*

  run carriesACommentTwiceTest = init
    .then(addComment(OWNER, 0, 0))
    .then(sendFeedback(OWNER, 0, Set(0)))
    .then(sendFeedback(OWNER, 0, Set(0))).expect(s.last == Allowed and not(safety))
}

/** A Teammate's Allow is remembered: it outlives the request, on the owner's Host. */
module shares_remember_mutant {
  import shares_model(BUG_UNSCOPED=false, BUG_RESEND=false, BUG_REMEMBER=true, BUG_COMMENTERS=false).*

  run rememberedByATeammateTest = init
    .then(createShare(0, 1, SessionT(0), "contributor", DEFAULT_LIFETIME))
    .then(hello(1, true))
    .then(requestApproval(0, 0))
    .then(respond(1, 0, true)).expect(s.last == Allowed and not(safety))
}

/** Needs You ignores the Grant: a Commenter's devices are asked what they can't answer. */
module shares_commenters_mutant {
  import shares_model(BUG_UNSCOPED=false, BUG_RESEND=false, BUG_REMEMBER=false, BUG_COMMENTERS=true).*

  run commenterIsAskedTest = init
    .then(createShare(0, 1, SessionT(0), "commenter", DEFAULT_LIFETIME))
    .then(requestApproval(0, 0)).expect(s.pushed == Set(OWNER, 1) and not(safety))
}

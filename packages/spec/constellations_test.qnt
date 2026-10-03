module constellations_test {
  import constellations(
    TASKS = Set(0, 1, 2, 3), SESSIONS = Set(0, 1, 2, 3), IDS = Set(0, 1, 2, 3, 4, 5),
    OWNER = "lead-host", CAPACITY = 2,
  ).* from "./constellations"

  action base = init.then(plan([
    Add({ task: 0, deps: Set(), parent: -1, gate: false }),
    Add({ task: 1, deps: Set(0), parent: -1, gate: false }),
    Add({ task: 2, deps: Set(0, 1), parent: -1, gate: true }),
  ])).then(setState("running")).expect(safety)
  action working = base.then(start(0, 1, -1)).expect(safety)
  action claimed = working.then(claim(0, 1, 42, false, true)).expect(safety)

  action parentBase = init.then(plan([
    Add({ task: 0, deps: Set(), parent: 1, gate: false }),
    Add({ task: 1, deps: Set(), parent: -1, gate: false }),
    Add({ task: 2, deps: Set(1), parent: -1, gate: true }),
  ])).then(setState("running")).expect(safety)

  run parentRollupAndGateDependencyTest = parentBase
    .expect(taskState(view, 1) == "ready" and view.promotions == [])
    .then(start(1, 1, -1)).expect(view.attempts == [] and safety)
    .then(start(0, 1, -1)).expect(taskState(view, 1) == "working" and safety)
    .then(claim(0, 1, 42, false, true)).expect(taskState(view, 1) == "working" and safety)
    .then(accept(0, 2, 42)).expect(taskState(view, 1) == "done" and view.promotions == [2] and safety)

  run inheritedDependenciesBlockTwoLevelsAndGateTest = init.then(plan([
    Add({ task: 0, deps: Set(), parent: -1, gate: false }),
    Add({ task: 1, deps: Set(0), parent: -1, gate: false }),
    Add({ task: 2, deps: Set(), parent: 1, gate: false }),
    Add({ task: 3, deps: Set(), parent: 2, gate: true }),
  ])).then(setState("running"))
    .expect(not(ready(view, 3)) and taskState(view, 1) == "waiting" and view.promotions == [] and safety)
    .then(start(3, 1, -1)).expect(view.attempts == [] and safety)
    .then(start(0, 1, -1)).then(claim(0, 1, 42, false, true)).then(accept(0, 2, 42))
    .expect(ready(view, 3) and taskState(view, 1) == "ready" and view.promotions == [3] and safety)

  run parentDependencyEditBlocksCompletedChildrenTest = init.then(plan([
    Add({ task: 0, deps: Set(), parent: -1, gate: false }),
    Add({ task: 1, deps: Set(), parent: -1, gate: false }),
    Add({ task: 2, deps: Set(), parent: 1, gate: false }),
    Add({ task: 3, deps: Set(), parent: 2, gate: false }),
  ])).then(setState("running")).then(start(3, 1, -1))
    .then(plan([Edit({ task: 1, deps: Set(0), parent: -1, gate: false, revision: 1 })]))
    .expect(taskState(view, 1) == "working" and not(ready(view, 3)) and safety)
    .then(claim(0, 1, 42, false, true)).then(accept(0, 2, 42))
    .expect(taskState(view, 3) == "done" and taskState(view, 1) == "waiting" and not(accepted(view, 1)) and safety)
    .then(start(0, 1, -1)).then(claim(1, 1, 42, false, true)).then(accept(1, 2, 42))
    .expect(taskState(view, 1) == "done" and accepted(view, 1) and safety)

  run parentCompletionEdgesRejectDependencyDeadlocksTest = init.then(plan([
    Add({ task: 0, deps: Set(), parent: -1, gate: false }),
    Add({ task: 1, deps: Set(2), parent: 0, gate: false }),
    Add({ task: 2, deps: Set(0), parent: -1, gate: false }),
  ])).expect(TASKS.forall(t => not(view.tasks.get(t).declared)) and safety)

  run nestedParentsAndCascadeCancellationTest = init.then(plan([
    Add({ task: 0, deps: Set(), parent: -1, gate: false }),
    Add({ task: 1, deps: Set(), parent: 0, gate: false }),
    Add({ task: 2, deps: Set(), parent: 1, gate: false }),
  ])).expect(safety).then(plan([Cancel({ task: 0, revision: 1 })]))
    .expect(Set(0, 1, 2).forall(t => taskState(view, t) == "canceled") and safety)

  run parentValidationRejectsCyclesGateAndAncestryDepsTest = parentBase
    .then(plan([Edit({ task: 1, deps: Set(), parent: -1, gate: true, revision: 1 })]))
    .expect(not(view.tasks.get(1).gate) and safety)
    .then(plan([Edit({ task: 1, deps: Set(), parent: 0, gate: false, revision: 1 })]))
    .expect(view.tasks.get(1).parent == -1 and safety)
    .then(plan([Edit({ task: 0, deps: Set(), parent: 2, gate: false, revision: 1 })]))
    .expect(view.tasks.get(0).parent == 1 and safety)
    .then(plan([Edit({ task: 0, deps: Set(1), parent: 1, gate: false, revision: 1 })]))
    .expect(view.tasks.get(0).deps == Set() and safety)

  run startedParentAndActiveDescendantCancelRefusedTest = parentBase.then(start(0, 1, -1))
    .then(plan([Cancel({ task: 1, revision: 1 }), Cancel({ task: 2, revision: 1 })]))
    .expect(not(view.tasks.get(0).canceled) and safety)
    .then(plan([Edit({ task: 2, deps: Set(), parent: 0, gate: true, revision: 1 })]))
    .expect(view.tasks.get(2).parent == -1 and safety)

  run reviewMetadataKeepsClaimInReviewUntilMergeTest = claimed
    .then(replay([{ host: OWNER, kind: ClaimHandedUp(0) }, { host: OWNER, kind: ClaimApproved(0) }]))
    .expect(view.attempts[0].status == "review" and view.handups == [0] and view.approvals == [0] and safety)
    .then(accept(0, 4, 42)).expect(view.attempts[0].status == "accepted" and safety)

  run silentEndNudgeIsDurableAndStatePreservingTest = working
    .then(replay([{ host: OWNER, kind: AttemptNudged(0) }]))
    .then(restart).expect(view.nudges == [0] and view.attempts[0].status == "working" and safety)

  run atomicPlanRejectsEveryOperationOnACycleTest = base
    .then(plan([Edit({ task: 0, deps: Set(1), parent: -1, gate: false, revision: 1 }), Add({ task: 1, deps: Set(), parent: -1, gate: false })]))
    .expect(view.tasks.get(0).deps == Set() and view.tasks.get(0).revision == 1 and safety)
    .then(plan([Edit({ task: 0, deps: Set(2), parent: -1, gate: false, revision: 1 })]))
    .expect(view.tasks.get(0).deps == Set() and graphAcyclic)

  run cancelNamesDependentsAndStaleEditIsRefusedTest = base
    .then(plan([Cancel({ task: 0, revision: 1 })]))
    .expect(not(view.tasks.get(0).canceled) and safety)
    .then(plan([Edit({ task: 1, deps: Set(), parent: -1, gate: false, revision: 0 })]))
    .expect(view.tasks.get(1).deps == Set(0) and view.tasks.get(1).revision == 1 and safety)

  run linkedCausesPointBackwardTest = claimed
    .then(reject(0, 2)).then(start(0, 2, 0))
    .expect(view.attempts.length() == 2 and view.attempts[1].ref == 0 and causesPointBackward and safety)
    .then(start(1, 3, 1)).expect(view.attempts.length() == 2 and safety)

  run taskFollowsItsLatestAttemptTest = claimed
    .then(reject(0, 2)).then(start(0, 2, 0))
    .expect(taskState(view, 0) == "working" and taskFollowsLatestAttempt and safety)
    .then(claim(0, 3, 42, false, true)).expect(taskState(view, 0) == "working" and safety)

  run gateCountsOnlyAcceptedAttemptsAndPromotesOnceTest = claimed
    .expect(view.promotions == [] and safety)
    .then(accept(0, 2, 43)).expect(view.attempts[0].status == "review" and safety)
    .then(accept(0, 2, 42)).then(start(1, 2, -1))
    .then(claim(1, 1, 42, false, true)).expect(view.promotions == [] and safety)
    .then(accept(1, 2, 42)).expect(view.promotions == [2] and gatePromotedOnlyAfterAccepted and safety)
    .then(accept(1, 2, 42)).expect(view.promotions == [2] and safety)

  run handoverIsAtomicAndDoesNotTouchWorkersTest = working
    .then(ask(0, 0)).then(handover(3))
    .expect(view.lead == 3 and view.attempts[0].session == 1 and view.attempts[0].status == "working" and pending.contains(0) and oneLead and safety)

  run sessionCannotCarryTwoActiveAttemptsTest = claimed
    .then(accept(0, 2, 42)).then(start(1, 1, -1))
    .then(start(0, 1, 0)).expect(view.attempts.length() == 2 and oneActiveAttemptPerSession and safety)

  run settlesAndQuestionsAreDeliveredOnceAcrossRestartTest = claimed
    .then(ask(0, 0)).then(availability(true, false, Set()))
    .then(deliver).expect(delivered.size() == 0 and safety)
    .then(restart).then(deliver)
    .expect(delivered == Set(0, 10) and pending == Set() and exactlyOnceDelivery and safety)
    .then(restart).then(deliver).expect(view.deliveries.length() == 2 and safety)

  run settledAttemptsNeverChangeTest = claimed.then(accept(0, 2, 42))
    .then(progress(0, 3)).then(claim(0, 3, 43, false, true)).then(reject(0, 3)).then(stop(0, 3))
    .expect(view.attempts[0].status == "accepted" and view.attempts[0].revision == 3 and settledAttemptImmutable and safety)

  run claimRequiresCleanBranchAndLatestRevisionTest = working
    .then(claim(0, 1, 42, true, true)).then(claim(0, 1, 42, false, false))
    .then(progress(0, 1)).then(claim(0, 1, 42, false, true))
    .expect(view.attempts[0].status == "working" and safety)
    .then(claim(0, 2, 42, false, true)).expect(view.attempts[0].status == "review" and safety)

  run outboxRetriesSurviveAppDisconnectAndLostAckTest = working
    .then(enqueue(0, 0, 42)).then(availability(false, true, Set()))
    .then(relay(0)).expect(view.applied == [] and view.attempts[0].status == "working" and safety)
    .then(availability(true, true, Set())).then(relay(0))
    .expect(view.applied == [0] and view.attempts[0].status == "review" and safety)
    .then(restart).then(availability(false, true, Set())).then(availability(true, true, Set()))
    .then(relay(0)).expect(view.applied == [0] and outboxAppliedExactlyOnce and safety)

  run onlyTheOwnerDaemonCommitsTest = working
    .then(commit("worker-host", [LeadChanged({ to: 3, request: -1 })]))
    .expect(view.lead == 0 and onlyOwnerCommits and safety)
    .then(availability(true, false, Set())).then(claim(0, 1, 42, false, true))
    .expect(view.attempts[0].status == "working" and safety)

  run delegatedRecoveryContinuesOnlyOnceTest = working
    .then(interrupt(0)).then(restart).then(recover(0)).then(recover(0))
    .expect(view.recoveries == [{ attempt: 0, interruption: 1 }] and recoveryAtMostOnce and safety)
    .then(interrupt(0)).then(restart).then(recover(0))
    .expect(view.recoveries.length() == 1 and view.attempts[0].status == "working" and safety)

  run staleHostCannotMechanicallySettleTest = working
    .then(availability(true, true, Set(1))).then(harnessFail(0)).then(restart)
    .expect(view.attempts[0].status == "working" and safety)
    .then(stop(0, 1)).expect(view.attempts[0].status == "lost" and staleNeverSettlesWithoutCommand and safety)

  run oldLeadNeverReceivesAnInTransitDigestTest = claimed
    .then(setState("paused")).then(deliver).expect(view.deliveries == [] and safety)
    .then(handover(3)).then(restart).then(setState("running")).then(deliver)
    .expect(view.deliveries == [{ id: 10, lead: 3 }] and noOldLeadDelivery and safety)

  run resourceCapacityCannotBeExceededTest = init
    .then(request(0)).then(request(1)).then(request(2))
    .then(grant).then(grant).then(grant)
    .expect(view.holders == Set(0, 1) and view.waiters == [2] and resourceCapacity and safety)

  run fifoWaiterIsGrantedWhenAHolderReleasesTest = init
    .then(request(0)).then(request(1)).then(request(2)).then(request(3))
    .then(grant).then(grant).then(restart).then(release(0)).then(grant)
    .expect(view.grants == [0, 1, 2] and view.waiters == [3] and safety)
    .then(release(1)).then(grant)
    .expect(view.grants == [0, 1, 2, 3] and view.waiters == [] and fifoGrantOrder and safety)
  run canceledWaiterDoesNotBlockFifoRecoveryTest = init.then(request(0)).then(request(1))
    .then(request(2)).then(cancelLease(0)).then(restart).then(grant).then(grant)
    .expect(view.grants == [1, 2] and view.waiters == [] and safety)

  // __workers uses these same resource events; scope close cancels or releases.
  run workerSlotScopeCloseAndRestartReclaimTest = init
    .then(commit(OWNER, [ResourceDeclared(1)]))
    .then(request(0)).then(request(1)).then(request(2)).then(grant).then(grant)
    .expect(view.holders == Set(0) and view.waiters == [1, 2] and resourceCapacity and fifoGrantOrder)
    .then(cancelLease(1)).then(release(0)).then(grant)
    .expect(view.grants == [0, 2] and view.holders == Set(2) and safety)
    .then(restart).then(release(2)).then(request(3)).then(grant)
    .expect(view.grants == [0, 2, 3] and view.holders == Set(3) and resourceCapacity and fifoGrantOrder and safety)
}

module constellations_property_test {
  import constellations(
    TASKS = Set(0, 1, 2), SESSIONS = Set(0, 1, 2, 3), IDS = Set(0, 1, 2, 3, 4, 5),
    OWNER = "lead-host", CAPACITY = 2,
  ).* from "./constellations"

  action base = init.then(plan([
    Add({ task: 0, deps: Set(), parent: -1, gate: false }),
    Add({ task: 1, deps: Set(0), parent: -1, gate: false }),
    Add({ task: 2, deps: Set(0, 1), parent: -1, gate: true }),
  ])).then(setState("running")).expect(safety)
  action working = base.then(start(0, 1, -1)).expect(safety)
  action claimed = working.then(claim(0, 1, 42, false, true)).expect(safety)

  run queuedHandoverSurvivesRestartTest = claimed.then(requestHandover(3)).then(restart)
    .then(finishHandover(3, 3)).then(deliver).expect(view.lead == 3 and handoverRequestOrdered and noOldLeadDelivery and safety)
  run supersededHandoverCannotSwitchTest = claimed.then(requestHandover(3)).then(requestHandover(4))
    .then(finishHandover(3, 3)).expect(view.lead == 0 and view.handoverRequest == 4 and safety)
    .then(finishHandover(4, 3)).then(deliver).expect(view.lead == 3 and safety)
  run cancelledHandoverCannotSwitchTest = claimed.then(requestHandover(3)).then(cancelHandover)
    .then(finishHandover(3, 3)).then(deliver).expect(view.lead == 0 and view.handoverRequest == -1 and safety)
  run detectsCancelledHandoverCompletionTest = claimed.then(requestHandover(3)).then(cancelHandover)
    .then(commit(OWNER, [LeadChanged({ to: 3, request: 3 })])).expect(not(handoverRequestOrdered))
  run detectsSupersededHandoverCompletionTest = claimed.then(requestHandover(3)).then(requestHandover(4))
    .then(commit(OWNER, [LeadChanged({ to: 3, request: 3 })])).expect(not(handoverRequestOrdered))
  run staleIntervalsSurviveRestartTest = working.then(commit(OWNER, [AttemptStale(0)])).then(restart)
    .expect(view.stale.contains(0) and view.attempts[0].status == "working" and safety)
    .then(commit(OWNER, [AttemptFresh(0)])).expect(not(view.stale.contains(0)) and safety)
  run detectsRepeatedWorkerInputTest = working.then(commit(OWNER, [WorkerInputDelivered({ id: 1, session: 1 }), WorkerInputDelivered({ id: 1, session: 1 })]))
    .expect(not(inputDeliveredAtMostOnce))
  run blockedApprovalInterruptionDoesNotContinueTest = working
    .then(replay([{ host: OWNER, kind: AttemptInterrupted({ attempt: 0, interruption: 1, eligible: false }) }]))
    .then(restart).then(recover(0)).expect(view.recoveries == [] and safety)
  run handoverStopsActiveGateAndSupersedesTest = claimed.then(accept(0, 2, 42))
    .then(start(1, 2, -1)).then(claim(1, 1, 42, false, true)).then(accept(1, 2, 42))
    .then(start(2, 0, -1)).then(requestHandover(4)).then(finishHandover(4, 3))
    .expect(view.lead == 3 and view.attempts[2].status == "lost" and oneLead and safety)
    .then(start(2, 3, 2)).expect(view.attempts.length() == 4 and view.attempts[3].ref == 2 and causesPointBackward and safety)
  run detectsCycleTest = base.then(commit(OWNER, [TaskEdited({ task: 0, deps: Set(1), parent: -1, gate: false })]))
    .expect(not(graphAcyclic))
  run detectsForwardCauseTest = base.then(commit(OWNER, [AttemptStarted({ task: 0, session: 1, ref: 1 })]))
    .expect(not(causesPointBackward))
  run detectsPrematureGateTest = base.then(commit(OWNER, [GatePromoted(2)]))
    .expect(not(gatePromotedOnlyAfterAccepted))
  run detectsRepeatedGateTest = claimed.then(accept(0, 2, 42)).then(start(1, 2, -1))
    .then(claim(1, 1, 42, false, true)).then(accept(1, 2, 42))
    .then(commit(OWNER, [GatePromoted(2)])).expect(not(gatePromotedOnlyAfterAccepted))
  run detectsSessionReuseRaceTest = working
    .then(commit(OWNER, [AttemptStarted({ task: 1, session: 1, ref: -1 })]))
    .expect(not(oneActiveAttemptPerSession))
  run detectsRepeatedNotificationTest = claimed.then(deliver)
    .then(commit(OWNER, [LeadNotified({ ids: Set(10), lead: 0 })]))
    .expect(not(exactlyOnceDelivery))
  run detectsDroppedSettleNotificationTest = working
    .then(commit(OWNER, [AttemptClaimed({ attempt: 0, sha: 42 })]))
    .expect(not(exactlyOnceDelivery))
  run detectsSettledAttemptMutationTest = claimed.then(accept(0, 2, 42))
    .then(commit(OWNER, [AttemptProgressed(0)])).expect(not(settledAttemptImmutable))
  run detectsRepeatedOutboxApplyTest = working
    .then(commit(OWNER, [OutboxApplied(0), OutboxApplied(0)]))
    .expect(not(outboxAppliedExactlyOnce))
  run detectsRepeatedRecoveryTest = working
    .then(commit(OWNER, [AttemptRecoveryContinued({ attempt: 0, interruption: 1 }), AttemptRecoveryContinued({ attempt: 0, interruption: 2 })]))
    .expect(not(recoveryAtMostOnce))
  run detectsStaleMechanicalSettleTest = working
    .then(commit(OWNER, [AttemptSettled({ attempt: 0, outcome: "lost", stale: true, commanded: false }), NotificationQueued({ id: 10, kind: "settle" })]))
    .expect(not(staleNeverSettlesWithoutCommand))
  run detectsOldLeadDeliveryTest = claimed.then(handover(3))
    .then(commit(OWNER, [LeadNotified({ ids: Set(10), lead: 0 })]))
    .expect(not(noOldLeadDelivery))
  run detectsCapacityViolationTest = init.then(request(0)).then(request(1)).then(request(2))
    .then(commit(OWNER, [ResourceLeased(0), ResourceLeased(1), ResourceLeased(2)]))
    .expect(not(resourceCapacity))
  run detectsMismatchedMergedHeadTest = claimed.then(commit(OWNER, [AttemptAccepted({ attempt: 0, sha: 43 })]))
    .expect(not(acceptanceMatchesClaim))
  run detectsForeignOwnerTest = working.then(replay([{ host: "worker-host", kind: LeadChanged({ to: 3, request: -1 }) }]))
    .expect(not(onlyOwnerCommits))
  run detectsFifoViolationTest = init.then(request(0)).then(request(1))
    .then(commit(OWNER, [ResourceLeased(1)])).expect(not(fifoGrantOrder))
}

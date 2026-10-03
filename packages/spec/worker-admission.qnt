module worker_admission {
  type Admission = {
    blocked: bool, foreground: bool, background: bool, reporting: bool,
    holders: Set[int], queue: List[int], pending: bool, receipt: bool,
    unblocks: int, bindings: bool, bStarted: bool, registered: bool,
    active: bool, replacement: bool, userPending: bool, userTurns: int,
    deferred: bool, inputGate: bool, steerAnswered: bool, acks: int, startup: bool, briefStarted: bool,
    failed: bool, refusals: int, abandoned: bool,
  }
  var slots: Admission
  action init = slots' = {
    blocked: false, foreground: true, background: false, reporting: false,
    holders: Set(0), queue: [1], pending: false, receipt: false,
    unblocks: 0, bindings: true, bStarted: false, registered: true,
    active: true, replacement: false, userPending: false, userTurns: 0,
    deferred: false, inputGate: false, steerAnswered: false, acks: 0, startup: false, briefStarted: false,
    failed: false, refusals: 0, abandoned: false,
  }
  action block = all {
    slots.active, not(slots.blocked) and slots.unblocks == 0,
    slots' = { ...slots, blocked: true },
  }
  action foregroundEnded = all {
    slots.foreground,
    slots' = { ...slots, foreground: false, reporting: slots.background }
  }
  action inlineReport = all {
    slots.foreground, slots.background,
    slots' = { ...slots, background: false },
  }
  action spawnBackground = all {
    slots.active, slots.holders.contains(0), slots.foreground,
    slots' = { ...slots, background: true, reporting: true },
  }
  action backgroundReported = slots' = { ...slots, background: false }
  action nativeStart = all {
    slots.active, slots.reporting and not(slots.foreground), slots.holders.contains(0),
    slots' = { ...slots, foreground: true },
  }
  action reportingEnded = all {
    slots.reporting and slots.foreground,
    slots' = { ...slots, reporting: slots.background, foreground: false },
  }
  action releaseBlocked = all {
    slots.active, slots.blocked, not(slots.foreground), not(slots.background), not(slots.reporting),
    not(slots.pending),
    slots' = { ...slots, holders: slots.holders.exclude(Set(0)) },
  }
  action startupAbandoned = all {
    slots.active, slots.registered, slots.startup, not(slots.foreground), not(slots.failed),
    slots' = { ...slots, abandoned: true, startup: false },
  }
  action releaseAbandoned = all {
    slots.active, slots.registered, slots.abandoned, not(slots.foreground),
    not(slots.background), not(slots.reporting), not(slots.pending),
    slots' = { ...slots, holders: slots.holders.exclude(Set(0)) },
  }
  action grant = all {
    slots.holders.size() == 0, slots.queue.length() > 0,
    slots.queue[0] != 0 or (slots.registered and slots.active and not(slots.failed)),
    slots' = { ...slots, holders: Set(slots.queue[0]), queue: slots.queue.slice(1, slots.queue.length()),
      bStarted: slots.bStarted or slots.queue[0] == 1 },
  }
  action resumeInput = all {
    slots.active, not(slots.failed), slots.blocked, not(slots.pending), not(slots.receipt),
    slots' = { ...slots, pending: true, queue: if (slots.holders.contains(0)) slots.queue else slots.queue.append(0) },
  }
  action userInput = all {
    slots.active, not(slots.failed), slots.blocked or slots.abandoned, not(slots.pending),
    slots' = { ...slots, pending: true, userPending: true,
      queue: if (slots.holders.contains(0)) slots.queue else slots.queue.append(0) },
  }
  action acceptedDeferredUser = all {
    slots.active, slots.foreground, not(slots.deferred),
    slots' = { ...slots, deferred: true },
  }
  action takeInputGate = all {
    slots.active, slots.registered, slots.pending, slots.holders.contains(0),
    slots' = { ...slots, inputGate: true },
  }
  action steer = all {
    not(slots.inputGate), slots' = { ...slots, steerAnswered: true },
  }
  action pendingBrief = all {
    slots.active, not(slots.foreground), not(slots.startup),
    slots' = { ...slots, startup: true },
  }
  action startBrief = all {
    slots.active, slots.registered, slots.startup, slots.holders.contains(0), not(slots.foreground),
    slots' = { ...slots, foreground: true, startup: false, briefStarted: true },
  }
  action applyUser = all {
    slots.active, slots.registered, slots.pending, slots.userPending,
    slots.inputGate, slots.holders.contains(0), not(slots.foreground), not(slots.startup),
    slots' = { ...slots, foreground: true, pending: false, userPending: false,
      userTurns: slots.userTurns + 1, inputGate: false, deferred: false },
  }
  action register = all {
    slots.active, not(slots.failed), not(slots.registered), slots' = { ...slots, registered: true },
  }
  // Durable assignment facts remain after startup cleanup; failed admission refuses later inputs.
  action startupFailed = all {
    slots.active, slots.registered, not(slots.failed),
    slots' = { ...slots, failed: true, registered: false, foreground: false,
      background: false, reporting: false, pending: false, userPending: false,
      inputGate: false, holders: slots.holders.exclude(Set(0)), queue: slots.queue.select(id => id != 0) },
  }
  action refuseFailedInput = all {
    slots.failed, slots' = { ...slots, refusals: slots.refusals + 1 },
  }
  action stop = all {
    slots.active,
    slots' = { ...slots, active: false, failed: false, registered: false, startup: false, foreground: false, background: false,
      reporting: false, bindings: false, pending: false, userPending: false,
      deferred: false, inputGate: false, holders: slots.holders.exclude(Set(0)),
      queue: slots.queue.select(id => id != 0) },
  }
  action sendBack = all {
    slots.active,
    slots' = { ...slots, active: false, failed: false, registered: false, startup: false, foreground: false, background: false,
      reporting: false, bindings: false, replacement: true, pending: false,
      userPending: false, deferred: false, inputGate: false,
      holders: slots.holders.exclude(Set(0)), queue: slots.queue.select(id => id != 0) },
  }
  action assignmentEnded = stop
  action ordinaryUserInput = all {
    not(slots.active), not(slots.failed), not(slots.foreground),
    slots' = { ...slots, foreground: true, userTurns: slots.userTurns + 1 },
  }
  action claimB = slots' = { ...slots, holders: slots.holders.exclude(Set(1)) }
  // Admission precedes the existing atomic unblock/Turn commit, which doubles as a remote receipt.
  action apply = all {
    slots.active, slots.registered, slots.inputGate, slots.pending, not(slots.userPending),
    slots.blocked, slots.holders.contains(0), not(slots.foreground), not(slots.receipt),
    slots' = { ...slots, blocked: false, foreground: true, pending: false,
      receipt: true, unblocks: slots.unblocks + 1, inputGate: false, acks: slots.acks + 1 },
  }
  action retry = slots' = { ...slots, acks: if (slots.receipt) slots.acks + 1 else slots.acks }
  // A Daemon restart stops native work and rebuilds blocked bindings without restoring an idle lease.
  action restart = all {
    slots.active, slots.blocked, not(slots.receipt),
    slots' = { ...slots, foreground: false, background: false, reporting: false,
      registered: false, inputGate: false, holders: Set(), queue: if (slots.pending) [0] else [] },
  }
  action step = any {
    block, foregroundEnded, spawnBackground, backgroundReported, nativeStart,
    reportingEnded, inlineReport, releaseBlocked, grant, resumeInput, claimB, apply,
    retry, restart, register, userInput, acceptedDeferredUser, takeInputGate,
    steer, applyUser, stop, sendBack, pendingBrief, startBrief, startupFailed, refuseFailedInput,
    startupAbandoned, releaseAbandoned, assignmentEnded, ordinaryUserInput,
  }
  val safety = all {
    slots.holders.size() <= 1,
    slots.unblocks <= 1,
    slots.active implies slots.bindings,
    slots.inputGate implies (slots.registered and slots.holders.contains(0)),
    slots.acks > 0 implies slots.receipt,
    (slots.active and slots.userTurns > 0 and slots.foreground) implies slots.holders.contains(0),
    slots.queue.length() == slots.queue.foldl(Set(), (ids, id) => ids.union(Set(id))).size(),
    (slots.active and slots.receipt and slots.foreground) implies slots.holders.contains(0),
    slots.reporting implies slots.holders.contains(0),
    slots.failed implies (not(slots.registered) and not(slots.foreground) and not(slots.holders.contains(0))),
  }
  val witnessBlockedRelease = slots.blocked and slots.bStarted
  val witnessResumed = slots.receipt
}

module worker_admission_test {
  import worker_admission.*
  run failedAssignmentEndsRestoresSessionTest = init.then(startupFailed).then(refuseFailedInput)
    .then(assignmentEnded).then(grant).then(ordinaryUserInput)
    .expect(not(slots.active) and not(slots.failed) and slots.foreground and slots.userTurns == 1 and slots.holders == Set(1) and safety)
  run abandonedStartupUserReacquiresTest = init.then(foregroundEnded).then(pendingBrief)
    .then(startupAbandoned).then(releaseAbandoned).then(grant).then(userInput)
    .expect(slots.bindings and slots.registered and slots.holders == Set(1) and safety)
    .then(claimB).then(grant).then(takeInputGate).then(applyUser)
    .expect(slots.userTurns == 1 and slots.holders == Set(0) and slots.refusals == 0 and safety)
  run abandonedStartupPinnedInputKeepsSlotTest = init.then(foregroundEnded).then(pendingBrief)
    .then(startupAbandoned).then(userInput).then(takeInputGate).then(applyUser)
    .expect(slots.bindings and slots.registered and slots.holders == Set(0) and slots.userTurns == 1 and safety)
  run failedStartupRejectsUserAndLeadTest = init.then(startupFailed).then(refuseFailedInput)
    .then(refuseFailedInput).then(grant)
    .expect(slots.active and slots.refusals == 2 and slots.bStarted and slots.userTurns == 0 and safety)
  run leadResumeWaitsForBTest = init.then(block).then(foregroundEnded).then(releaseBlocked)
    .then(grant).then(resumeInput).expect(slots.holders == Set(1) and slots.blocked and safety)
    .then(claimB).then(grant).then(takeInputGate).then(apply).then(retry)
    .expect(slots.unblocks == 1 and not(slots.blocked) and safety)
  run acceptanceReacquiresTest = init.then(block).then(foregroundEnded).then(releaseBlocked)
    .then(grant).then(claimB).then(resumeInput).then(grant).then(takeInputGate).then(apply)
    .expect(slots.unblocks == 1 and slots.holders == Set(0) and safety)
  run backgroundReportingGapRetainsTest = init.then(block).then(spawnBackground)
    .then(foregroundEnded).then(backgroundReported)
    .expect(slots.reporting and slots.holders == Set(0) and safety)
    .then(nativeStart).then(reportingEnded).then(releaseBlocked).then(grant)
    .expect(slots.bStarted and slots.bindings and safety)
  run restartBeforeAdmissionTest = init.then(block).then(foregroundEnded).then(releaseBlocked)
    .then(grant).then(resumeInput).then(restart).expect(slots.pending and slots.bindings and safety)
    .then(register).then(grant).then(takeInputGate).then(apply).then(retry).expect(slots.unblocks == 1 and safety)
  run earlierReportRetainsLiveChildTest = init.then(block).then(spawnBackground)
    .then(foregroundEnded).then(nativeStart).then(reportingEnded).then(backgroundReported)
    .expect(slots.reporting and slots.holders == Set(0) and safety)
    .then(nativeStart).then(reportingEnded).then(releaseBlocked).then(grant)
    .expect(slots.bStarted and safety)
  run inlineReportBeforeBlockReleasesTest = init.then(spawnBackground).then(inlineReport)
    .then(block).then(foregroundEnded).then(releaseBlocked).then(grant)
    .expect(slots.bStarted and not(slots.reporting) and safety)
  run directUserWaitsOutsideInputGateTest = init.then(block).then(foregroundEnded)
    .then(releaseBlocked).then(grant).then(userInput).then(steer)
    .expect(slots.userPending and slots.steerAnswered and not(slots.inputGate) and safety)
    .then(claimB).then(grant).then(takeInputGate).then(applyUser)
    .expect(slots.userTurns == 1 and slots.blocked and safety)
  run deferredUserReacquiresTest = init.then(block).then(acceptedDeferredUser)
    .then(foregroundEnded).then(releaseBlocked).then(grant).then(userInput).then(steer)
    .then(claimB).then(grant).then(takeInputGate).then(applyUser)
    .expect(not(slots.deferred) and slots.userTurns == 1 and safety)
  run preBriefUserWaitsBehindAdmissionTest = init.then(block).then(foregroundEnded)
    .then(releaseBlocked).then(grant).then(pendingBrief).then(userInput)
    .expect(slots.startup and slots.userPending and not(slots.inputGate) and safety)
    .then(claimB).then(grant).then(takeInputGate).then(startBrief)
    .expect(slots.briefStarted and slots.userTurns == 0 and safety)
    .then(foregroundEnded).then(applyUser).expect(slots.userTurns == 1 and safety)
  run stopQueuedUnblockHasNoReceiptTest = init.then(block).then(foregroundEnded)
    .then(releaseBlocked).then(grant).then(resumeInput).then(stop).then(retry)
    .expect(slots.acks == 0 and slots.unblocks == 0 and not(slots.pending) and safety)
  run sendBackQueuedUnblockHasNoReceiptTest = init.then(block).then(foregroundEnded)
    .then(releaseBlocked).then(grant).then(resumeInput).then(sendBack).then(retry)
    .expect(slots.replacement and slots.acks == 0 and slots.unblocks == 0 and safety)
  run waitingUnderInputGateIsUnsafeTest = init.then(block).then(foregroundEnded)
    .then(releaseBlocked).then(grant).then(resumeInput)
    .then(slots' = { ...slots, inputGate: true }).expect(not(safety))
  run ackCanceledInputIsUnsafeTest = init.then(block).then(foregroundEnded)
    .then(releaseBlocked).then(grant).then(resumeInput).then(stop)
    .then(slots' = { ...slots, acks: 1 }).expect(not(safety))
  run releaseDuringReportingIsUnsafeTest = init.then(block).then(spawnBackground).then(foregroundEnded)
    .then(backgroundReported).then(slots' = { ...slots, holders: Set() }).expect(not(safety))
  run executeWithoutAdmissionIsUnsafeTest = init.then(block).then(foregroundEnded).then(releaseBlocked)
    .then(slots' = { ...slots, receipt: true, foreground: true }).expect(not(safety))
}

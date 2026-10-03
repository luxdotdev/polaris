module worker_admission {
  type Admission = {
    blocked: bool, foreground: bool, background: bool, reporting: bool,
    holders: Set[int], queue: List[int], pending: bool, receipt: bool,
    unblocks: int, bindings: bool, bStarted: bool,
  }
  var slots: Admission
  action init = slots' = {
    blocked: false, foreground: true, background: false, reporting: false,
    holders: Set(0), queue: [1], pending: false, receipt: false,
    unblocks: 0, bindings: true, bStarted: false,
  }
  action block = all {
    not(slots.blocked) and slots.unblocks == 0,
    slots' = { ...slots, blocked: true },
  }
  action foregroundEnded = slots' = { ...slots, foreground: false }
  action spawnBackground = all {
    slots.holders.contains(0), slots.foreground,
    slots' = { ...slots, background: true, reporting: true },
  }
  action backgroundReported = slots' = { ...slots, background: false }
  action nativeStart = all {
    slots.reporting and not(slots.foreground), slots.holders.contains(0),
    slots' = { ...slots, foreground: true },
  }
  action reportingEnded = all {
    slots.reporting and slots.foreground,
    slots' = { ...slots, reporting: slots.background, foreground: false },
  }
  action releaseBlocked = all {
    slots.blocked, not(slots.foreground), not(slots.background), not(slots.reporting),
    not(slots.pending),
    slots' = { ...slots, holders: slots.holders.exclude(Set(0)) },
  }
  action grant = all {
    slots.holders.size() == 0, slots.queue.length() > 0,
    slots' = { ...slots, holders: Set(slots.queue[0]), queue: slots.queue.slice(1, slots.queue.length()),
      bStarted: slots.bStarted or slots.queue[0] == 1 },
  }
  action resumeInput = all {
    slots.blocked, not(slots.pending), not(slots.receipt),
    slots' = { ...slots, pending: true, queue: if (slots.holders.contains(0)) slots.queue else slots.queue.append(0) },
  }
  action claimB = slots' = { ...slots, holders: slots.holders.exclude(Set(1)) }
  // Admission precedes the existing atomic unblock/Turn commit, which doubles as a remote receipt.
  action apply = all {
    slots.pending, slots.blocked, slots.holders.contains(0), not(slots.foreground), not(slots.receipt),
    slots' = { ...slots, blocked: false, foreground: true, pending: false, receipt: true, unblocks: slots.unblocks + 1 },
  }
  action retry = slots' = slots
  // A Daemon restart stops native work and rebuilds blocked bindings without restoring an idle lease.
  action restart = all {
    slots.blocked, not(slots.receipt),
    slots' = { ...slots, foreground: false, background: false, reporting: false,
      holders: Set(), queue: if (slots.pending) [0] else [] },
  }
  action step = any {
    block, foregroundEnded, spawnBackground, backgroundReported, nativeStart,
    reportingEnded, releaseBlocked, grant, resumeInput, claimB, apply, retry, restart,
  }
  val safety = all {
    slots.holders.size() <= 1,
    slots.unblocks <= 1,
    slots.bindings,
    slots.queue.length() == slots.queue.foldl(Set(), (ids, id) => ids.union(Set(id))).size(),
    (slots.receipt and slots.foreground) implies slots.holders.contains(0),
    slots.reporting implies slots.holders.contains(0),
  }
  val witnessBlockedRelease = slots.blocked and slots.bStarted
  val witnessResumed = slots.receipt
}

module worker_admission_test {
  import worker_admission.*
  run leadResumeWaitsForBTest = init.then(block).then(foregroundEnded).then(releaseBlocked)
    .then(grant).then(resumeInput).expect(slots.holders == Set(1) and slots.blocked and safety)
    .then(claimB).then(grant).then(apply).then(retry)
    .expect(slots.unblocks == 1 and not(slots.blocked) and safety)
  run acceptanceReacquiresTest = init.then(block).then(foregroundEnded).then(releaseBlocked)
    .then(grant).then(claimB).then(resumeInput).then(grant).then(apply)
    .expect(slots.unblocks == 1 and slots.holders == Set(0) and safety)
  run backgroundReportingGapRetainsTest = init.then(block).then(spawnBackground)
    .then(foregroundEnded).then(backgroundReported)
    .expect(slots.reporting and slots.holders == Set(0) and safety)
    .then(nativeStart).then(reportingEnded).then(releaseBlocked).then(grant)
    .expect(slots.bStarted and slots.bindings and safety)
  run restartBeforeAdmissionTest = init.then(block).then(foregroundEnded).then(releaseBlocked)
    .then(grant).then(resumeInput).then(restart).expect(slots.pending and slots.bindings and safety)
    .then(grant).then(apply).then(retry).expect(slots.unblocks == 1 and safety)
  run earlierReportRetainsLiveChildTest = init.then(block).then(spawnBackground)
    .then(foregroundEnded).then(nativeStart).then(reportingEnded).then(backgroundReported)
    .expect(slots.reporting and slots.holders == Set(0) and safety)
    .then(nativeStart).then(reportingEnded).then(releaseBlocked).then(grant)
    .expect(slots.bStarted and safety)
  run releaseDuringReportingIsUnsafeTest = init.then(block).then(spawnBackground).then(foregroundEnded)
    .then(backgroundReported).then(slots' = { ...slots, holders: Set() }).expect(not(safety))
  run executeWithoutAdmissionIsUnsafeTest = init.then(block).then(foregroundEnded).then(releaseBlocked)
    .then(slots' = { ...slots, receipt: true, foreground: true }).expect(not(safety))
}

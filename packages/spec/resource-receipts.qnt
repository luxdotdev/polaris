/** A bounded private challenge never authorizes a move after authority or group revision changes. */
module resource_receipts {
  var generation: int
  var groupRevision: int
  var receiptRevision: int
  var live: bool
  var pending: bool
  var challengeGeneration: int
  var challengeGroup: int
  var challengeReceipt: int
  var verified: bool
  var moved: bool
  var staleMove: bool
  action init = all {
    generation' = 1, groupRevision' = 1, receiptRevision' = 1, live' = true,
    pending' = false, challengeGeneration' = 0, challengeGroup' = 0,
    challengeReceipt' = 0, verified' = false, moved' = false, staleMove' = false
  }
  action challenge = all {
    live, not(pending), pending' = true, challengeGeneration' = generation,
    challengeGroup' = groupRevision, challengeReceipt' = receiptRevision,
    verified' = false, generation' = generation, groupRevision' = groupRevision,
    receiptRevision' = receiptRevision, live' = live, moved' = moved, staleMove' = staleMove
  }
  val current = live and challengeGeneration == generation and challengeGroup == groupRevision and challengeReceipt == receiptRevision
  action reply = all {
    pending, pending' = false, verified' = current,
    generation' = generation, groupRevision' = groupRevision, receiptRevision' = receiptRevision,
    live' = live, challengeGeneration' = challengeGeneration, challengeGroup' = challengeGroup,
    challengeReceipt' = challengeReceipt, moved' = moved, staleMove' = staleMove
  }
  action waitChange(g: int, d: int, r: int, active: bool): bool = all {
    generation' = g, groupRevision' = d, receiptRevision' = r, live' = active,
    pending' = pending, challengeGeneration' = challengeGeneration, challengeGroup' = challengeGroup,
    challengeReceipt' = challengeReceipt, verified' = verified, moved' = moved, staleMove' = staleMove
  }
  action cancel = all {
    pending' = false, verified' = false, generation' = generation,
    groupRevision' = groupRevision, receiptRevision' = receiptRevision, live' = live,
    challengeGeneration' = challengeGeneration, challengeGroup' = challengeGroup,
    challengeReceipt' = challengeReceipt, moved' = moved, staleMove' = staleMove
  }
  action move = all {
    verified, current, moved' = true, staleMove' = staleMove or not(current), verified' = false,
    generation' = generation, groupRevision' = groupRevision, receiptRevision' = receiptRevision,
    live' = live, pending' = pending, challengeGeneration' = challengeGeneration,
    challengeGroup' = challengeGroup, challengeReceipt' = challengeReceipt
  }
  action step = any {
    challenge, reply, cancel, move,
    waitChange(generation + 1, groupRevision, receiptRevision, live),
    waitChange(generation, groupRevision + 1, receiptRevision, live),
    waitChange(generation, groupRevision, receiptRevision + 1, live),
    waitChange(generation, groupRevision, receiptRevision, false)
  }
  val witnessMove = moved
  run currentReplyAllowsMoveTest = init.then(challenge).then(reply).then(move).expect(moved)
  val safety = not(staleMove) and not(pending and verified)
  run changedGroupRefusesMoveTest = init.then(challenge).then(reply)
    .then(waitChange(generation, groupRevision + 1, receiptRevision, live)).expect(not(current))
  run cancellationClearsAuthorityTest = init.then(challenge).then(cancel).expect(not(pending) and not(verified))
  run responseBindsRevisionTest = init.then(challenge)
    .then(waitChange(generation, groupRevision, receiptRevision + 1, live)).then(reply).expect(not(verified))
}

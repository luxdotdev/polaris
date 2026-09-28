// -*- mode: Bluespec; -*-
/**
 * Scenario tests for polaris.qnt (`quint test`). Each run is one interleaving
 * written out by hand; `safety` must hold after every step of it.
 */
module polaris_test {
  import polaris(
    HOST_FEED_GAPLESS = false,
    CLIENTS = Set("mac", "phone"),
    SESSION_LIST = ["s1", "s2"],
    CMD_IDS = Set("k1", "k2", "k3", "k4"),
    REQUESTS = Set("r1", "r2"),
    REQUEST_SESSION = Map("r1" -> "s1", "r2" -> "s1"),
    CAPACITY = 2,
    MAX_LOG = 10,
    MAX_CRASHES = 2,
  ).* from "./polaris"

  pure val r1 = Respond({ session: "s1", req: "r1" })

  /** A Turn in s1 with its Harness running. */
  action turnRunning =
    init
      .then(clientSends("mac", "k1", SendTurn("s1")))
      .then(commitBatch)
      .then(publishBatch)
      .then(reactorRuns("s1"))

  /** …that asked for approval r1: seq 3 ApprovalRequested, seq 4 Needs You. */
  action waitingOnApproval =
    turnRunning
      .then(harnessReports("s1", HRequest("r1")))
      .then(commitBatch)
      .then(publishBatch)
      .expect(viewOf(log, "s1").state == "needs-you" and safety)

  run groupCommitDecidesInOrderTest =
    init
      .then(clientSends("mac", "k1", SendTurn("s1")))
      .then(clientSends("phone", "k2", SendTurn("s1")))
      .then(clientRetries("k1"))
      .then(commitBatch)
      .then(publishBatch)
      // One batch: k1 wins, k2 is decided against k1's events, the retry is answered from the batch.
      .expect(all {
        answers.get("k1") == [Ok(2), Dup(2)],
        answers.get("k2") == [Rejected],
        log.length() == 2,
        safety,
      })

  run retryAfterCrashIsAnsweredFromTheReceiptTest =
    init
      .then(clientSends("mac", "k1", SendTurn("s1")))
      .then(commitBatch)
      // Committed, then the Daemon dies before anyone hears of it.
      .then(crash)
      .then(restart)
      .expect(all {
        answers.get("k1") == [],
        viewOf(log, "s1") == { turn: "interrupted", state: "needs-you", pending: Set(), requested: [] },
        harness == Set(),
        safety,
      })
      .then(clientRetries("k1"))
      .then(commitBatch)
      .then(publishBatch)
      .expect(all { answers.get("k1") == [Dup(2)], log.length() == 4, reactor == Set(), safety })
      // Nothing continued on its own; the user does.
      .then(clientSends("mac", "k2", Continue("s1")))
      .then(commitBatch)
      .then(publishBatch)
      .then(reactorRuns("s1"))
      .expect(all { answers.get("k2") == [Ok(6)], harness == Set("s1"), safety })

  run twoDevicesAnswerAtOnceTest =
    waitingOnApproval
      .then(clientSends("mac", "k2", r1))
      .then(clientSends("phone", "k3", r1))
      .then(commitBatch)
      .then(publishBatch)
      .expect(all {
        answers.get("k2") == [Ok(6)],
        answers.get("k3") == [Rejected],
        log[4].kind == ApprovalResolved({ req: "r1", by: "mac" }),
        viewOf(log, "s1").state == "working",
        safety,
      })

  run harnessWithdrawalBeforeTheAnswerTest =
    waitingOnApproval
      .then(harnessReports("s1", HWithdraw("r1")))
      .then(clientSends("phone", "k2", r1))
      .then(commitBatch)
      .then(publishBatch)
      .expect(all {
        log[4].kind == ApprovalWithdrawn({ req: "r1", by: "harness" }),
        answers.get("k2") == [Rejected],
        safety,
      })

  run answerBeforeTheHarnessWithdrawalTest =
    waitingOnApproval
      .then(clientSends("phone", "k2", r1))
      .then(harnessReports("s1", HWithdraw("r1")))
      .then(commitBatch)
      .then(publishBatch)
      .expect(all {
        log[4].kind == ApprovalResolved({ req: "r1", by: "phone" }),
        // The withdrawal found nothing pending and recorded nothing.
        log.length() == 6,
        answers.get("k2") == [Ok(6)],
        safety,
      })

  run restartWithdrawsAndInterruptsTest =
    waitingOnApproval
      .then(crash)
      .then(restart)
      .expect(all {
        log[4].kind == TurnEnded("interrupted"),
        log[5].kind == ApprovalWithdrawn({ req: "r1", by: "daemon" }),
        log[6].kind == StateChanged("needs-you"),
        harness == Set(),
        safety,
      })
      // A late answer from a Client that had not heard is rejected.
      .then(clientSends("phone", "k2", r1))
      .then(commitBatch)
      .then(publishBatch)
      .expect(answers.get("k2") == [Rejected] and safety)

  run slowSubscriberIsDroppedAndResumesWithoutGapsTest =
    init
      .then(clientSends("mac", "k1", SendTurn("s1")))
      .then(commitBatch)
      .then(publishBatch)
      .then(subscribe("phone", "s1"))
      .then(readCut("phone", "s1"))
      .then(reactorRuns("s1"))
      .then(3.reps(_ => harnessReports("s1", HItem).then(commitBatch).then(publishBatch)))
      .expect(subs.get(("phone", "s1")).dropped and safety)
      // Snapshot, Synchronized, then the two buffered events; the stream then ends.
      .then(4.reps(_ => deliver("phone", "s1")))
      .then(streamEnds("phone", "s1"))
      .then(subscribe("phone", "s1"))
      .then(readCut("phone", "s1"))
      // Replays (4, 5], then Synchronized.
      .then(2.reps(_ => deliver("phone", "s1")))
      .expect(all {
        feeds.get(("phone", "s1")).seen == streamSeqs(log, "s1"),
        safety,
      })

  run hostFeedSkipsSessionOnlyEventsTest =
    init
      .then(subscribe("mac", HOST))
      .then(readCut("mac", HOST))
      .then(2.reps(_ => deliver("mac", HOST)))
      .then(clientSends("mac", "k1", SendTurn("s1")))
      .then(commitBatch)
      .then(publishBatch)
      .then(2.reps(_ => deliver("mac", HOST)))
      .then(reactorRuns("s1"))
      .then(harnessReports("s1", HItem))
      .then(harnessReports("s1", HTurnEnded))
      .then(commitBatch)
      .then(publishBatch)
      .then(2.reps(_ => deliver("mac", HOST)))
      // Without the gap check the host feed sees 1, 2, 4, 5: seq 3 is an ItemCompleted.
      .expect(feeds.get(("mac", HOST)).seen == [1, 2, 4, 5] and hostFeedCanProgress and safety)
}

/** The same host feed with the gap check `HostConnection` uses today. */
module polaris_current_test {
  import polaris(
    HOST_FEED_GAPLESS = true,
    CLIENTS = Set("mac", "phone"),
    SESSION_LIST = ["s1", "s2"],
    CMD_IDS = Set("k1", "k2", "k3", "k4"),
    REQUESTS = Set("r1", "r2"),
    REQUEST_SESSION = Map("r1" -> "s1", "r2" -> "s1"),
    CAPACITY = 2,
    MAX_LOG = 10,
    MAX_CRASHES = 2,
  ).* from "./polaris"

  run hostFeedGetsStuckOnASessionOnlyEventTest =
    init
      .then(subscribe("mac", HOST))
      .then(readCut("mac", HOST))
      .then(2.reps(_ => deliver("mac", HOST)))
      .then(clientSends("mac", "k1", SendTurn("s1")))
      .then(commitBatch)
      .then(publishBatch)
      .then(2.reps(_ => deliver("mac", HOST)))
      .then(reactorRuns("s1"))
      .then(harnessReports("s1", HItem))
      .then(harnessReports("s1", HTurnEnded))
      .then(commitBatch)
      .then(publishBatch)
      // seq 4 after 2: a gap, so the feed reopens from 2…
      .then(deliver("mac", HOST))
      .expect(subs.get(("mac", HOST)).phase == "closed" and feeds.get(("mac", HOST)).last == 2)
      // …the replay of (2, 5] starts at 4 again, and so on forever.
      .then(subscribe("mac", HOST))
      .then(readCut("mac", HOST))
      .then(deliver("mac", HOST))
      .expect(all {
        subs.get(("mac", HOST)).phase == "closed",
        feeds.get(("mac", HOST)).last == 2,
        not(hostFeedCanProgress),
        safety,
      })
}

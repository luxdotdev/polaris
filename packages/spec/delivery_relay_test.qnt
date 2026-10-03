module delivery_relay_test {
  import constellation_delivery_relay.* from "./constellations"

  run ownerReconnectDuringApplyUsesCurrentOwnerTest = init.then(acceptDependency).then(launch)
    .then(disconnectOwner).then(reconnectOwner).then(turnEnded).then(applyReceipt).then(acknowledge)
    .expect(relay.launchEpoch == 0 and relay.ackEpoch == 1 and relay.unblocks == 1 and safety)
    .then(cleanup).then(reconnectOwner).expect(relay.unblocks == 1 and safety)
  run assignmentFailureCleanupRetriesWithoutGraphEventTest = init.then(acceptDependency).then(launch)
    .then(cleanup).then(launch).then(turnEnded).then(applyReceipt).then(acknowledge)
    .expect(relay.attempts == 2 and relay.unblocks == 1 and safety)
  run persistentFailureWaitsForExternalChangeTest = init.then(acceptDependency).then(launch)
    .then(cleanup).then(launch).then(cleanup)
    .expect(relay.attempts == 2 and not(relay.receipt) and relay.blocked and safety)
    .then(graphChanged).then(launch).then(turnEnded).then(applyReceipt).then(acknowledge)
    .expect(relay.unblocks == 1 and safety)
}

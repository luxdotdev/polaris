# The Constellation stream lives on the Lead's Host

Constellations v1 (ENG-243) retains the rule that Daemons only talk to Clients.
The Lead's Host owns `constellation:<id>` and is the only Daemon that decides and
commits its events. A remote worker uses its own Host's Daemon, which validates
its authenticated session binding and local branch state, then persists a
worker command in a durable outbox. The Desktop App relays that entry over its
existing connections to both Hosts. A same-Host Constellation uses the owner
directly and needs no relay.

## Why

The graph's dependencies, Attempt revisions, accepted heads, Gate promotion and
Lead identity need one serialized decision point. Letting each Host write part
of the graph would turn a single-stream decider into a distributed consensus
problem. Making the owner reachable directly from every worker Host would add
Daemon-to-Daemon networking, authentication and discovery to a product whose
Clients already hold those connections.

The worker's local Daemon can verify its branch, uncommitted changes and binding;
the owner can verify graph authority, the latest Attempt and revision. Both
checks are needed. The outbox transports an intent, never an already committed
Constellation event or a caller-supplied role.

## Delivery and recovery

- Persist each outbox entry before acknowledging it locally. Its stable ID is
  retained across Desktop App disconnects and retries. The owner records that
  ID's decision atomically with its graph events, so a lost acknowledgement
  cannot apply it twice. Rejections are decisions too; retrying an ID returns
  the original decision rather than applying it against a later graph.
- The Desktop App relays decisions back so the worker Host can durably retire
  acknowledged entries. Removing an entry before that acknowledgement would
  lose a Claim or question on an app crash. Its result distinguishes locally
  queued work from an owner-committed decision.
- The Desktop App also carries git bundles: the dispatched base outward and
  the claimed branch inward. Applying a Claim does not imply that its branch
  has arrived. Until it does, Review says "branch not yet fetched"; acceptance
  still checks the merged head against the claimed head.
- While the app is disconnected, outboxes remain durable. While the Lead's Host
  is unavailable, nothing decides and the UI shows "waiting for the Lead's Host".
  The worker Host becoming Offline marks Attempts stale; it does not settle them.
- Recovery re-folds the owner's log. Pending notification IDs and in-transit
  messages survive it. A handover atomically changes the Lead and revokes the
  old binding; subsequent relay decisions and digest Turns use the current Lead.
  Workers and outboxes keep their assignment identities.

## Considered options

- **Each worker Host commits graph events.** Rejected: concurrent decisions
  need coordination across Hosts and can race Gate fan-in, reviews and handover.
- **Worker Daemons connect directly to the owner.** Rejected: adds a second
  network topology and credential/routing surface alongside the Client's.
- **Keep remote intents only in the Desktop App.** Rejected: closing the app
  could lose a worker's result after its tool call was acknowledged.

## Consequences

A remote worker can queue a Claim without the Desktop App, but cannot make the
graph advance until the relay returns. Cross-Host progress depends on the app
and the Lead's Host; local progress does not. The stream stays compatible with
the store's commit receipts, sequence and resumable feeds (ADR 0002).

The protocol is `packages/protocol/src/constellation/`: outbox entries accept
only worker commands, and verified receipts point to Host/session/Turn/item.
The owner must resolve those recorded items; a textual remote receipt remains
reported evidence until a Daemon-recorded reference can be verified.

The formal model is `packages/spec/constellations.qnt`: `commit`, `enqueue`,
`relay`, `handover`, `onlyOwnerCommits`, `outboxAppliedExactlyOnce` and
`noOldLeadDelivery`. It abstracts bundle bytes and binding cryptography; real
integration tests must verify local git checks, durable outbox storage and relay.

# Constellation Stats

`constellation.stats { constellationId }` returns `ConstellationStats`. It uses
the same read authority as status: the user, current Lead, or an active worker.
`polaris constellation stats <id> --json` reads that RPC and adds Client pricing.
Desktop Stats, completion cards, and Usage can use the same response; their
presentation and IPC wiring belong to the UI slices.

The service starts without reads, subscriptions, watchers, or timers. A view
reads the folded graph and source streams at one global sequence cut. It selects
only Session state/Turn boundaries and Host lease events in SQL, avoiding Turn
item decoding. A bounded 32-graph cache retains history at its graph revision and
sequence. Existing Usage response rows are read on demand, without changing the
index schema or recording telemetry. A response fingerprint invalidates usage
totals independently of graph revisions. Open intervals advance only on a view.

## Definitions

- Lead wakeups are recorded `LeadNotified` digests. Coalescing saves
  `max(items - 1, 0)` wakeups per digest; hit rate is saved wakeups / delivered
  items. Digest tokens and reported cost use exact matching Turn boundaries.
  Missing start history makes digest means unknown, with a coverage reason.
- Claim-to-review ends at the first user approval, acceptance, rejection, or
  settlement after the Claim. Acceptance rate counts accepted first Claims / all
  terminally resolved first Claims of their Tasks. Approval alone does not count
  a Task accepted. Send-back counts group retry Attempts by `SentBack` and
  `MergeConflict`, excluding initial, recovery, and follow-up Attempts.
- Worker working/idle time integrates recorded Session states within the
  Attempt's working phase, ending at Claim or another terminal transition.
  Slot and resource wait time integrates queued-to-granted/canceled intervals.
  Concurrent waits are unioned; state and wait durations can overlap and are
  not an exclusive partition. Slots use the reserved `__workers` resource.
- Task Usage uses each Attempt's exact timestamp window, including review up
  to its terminal outcome. Gaps between assignments of a reused Session do not
  belong to either Task. Lead handovers close the former Lead's role window.
  A Gate in its Lead's Session contributes to its Task and Lead role; role
  totals count each response once. Wall clock stops at completion, even if
  archival occurs later.

Usage preserves reported-cost coverage, cache durations, and long-context
subsets. The Daemon returns reported USD and attributed Usage buckets, never
fetching or estimating prices. The CLI uses the Client's bundled prices and
identifies API-equivalent estimates and unpriced tokens. Desktop Clients can
use their current price cache. Indexing and remote Usage are explicitly partial.

## Coverage

This Host cannot supply remote workers' Session/lease/Usage streams; Clients
must join their Hosts' Usage. Missing legacy slot facts and missing Session
history return null durations, not invented zeroes. Stale duration folds owner
`AttemptStale`/`AttemptFresh` facts by Attempt ID using `event.at`, including remote
workers. Open intervals advance on view and close at the Attempt's terminal end,
including its review phase. Replaying the journal restores open intervals after
restart. Zero means no recorded stale interval; a coverage reason makes clear that
unobserved or pre-journal offline intervals cannot be reconstructed. An idle
Constellation never wakes this service. No telemetry log or analytics service
is introduced.

Tests cover reused Sessions, handovers, overlapping/canceled waits, approval
before merge, completion before archive, missing and remote coverage, pricing,
cache invalidation, authorization, unchanged event/subscriber counts, SQL cuts,
and an isolated real Daemon/CLI round trip.

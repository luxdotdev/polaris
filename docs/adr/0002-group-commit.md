# The event store writes commits in groups

`EventStore.commit` never writes on the caller's fiber. The first commit that finds the store idle schedules a drain as a microtask; every commit queued by the time it runs (the fibers the scheduler was running in that turn) forms one batch. The drain decides each command in order against the model the ones before it produced, and writes the whole batch (events, projections and receipts) in one SQLite transaction. Subscribers hear of a batch, and callers get their result (the dispatch ack), only after that transaction commits.

## Why

A small commit is dominated by SQLite's per-transaction cost, not by its rows. Under load (many sessions streaming items at once) writing each command in its own transaction wasted most of the store's time; batching costs about a fifth of the SQL time of the same commands written one by one (bench `history`: seeding went from ~6.8k to ~9.5k events/s).

The microtask is what makes batching free when idle: it runs once the fibers running now have had their turn, so their commits join the batch, but before the event loop moves on, so a lone commit waits for no timer and no extra loop turn.

## Considered Options

- **One transaction per commit.** Simplest, and what the store did first. Rejected for the cost above.
- **A timed flush window** (e.g. every 2 ms). Rejected: it adds latency to every idle commit and needs tuning per machine.

## Consequences

- The sequence stays gapless and each command's events, projections and receipt stay atomic, because the whole batch is.
- A duplicate command id within one batch is answered from the batch's own receipts, since they are not yet visible in SQL.
- If a batch's transaction fails, nothing of it was written; its commands are retried one by one, so one bad command (or a transient error) only fails itself.
- The Quint spec models this as `commitBatch` (`packages/spec/polaris.qnt`); the model-based tests in `apps/daemon/src/verification/` check the real store against it.

# The event store runs SQLite in WAL mode with `synchronous = NORMAL`

The SQLite client opens the database in WAL mode, and the store sets `PRAGMA synchronous = NORMAL` when it starts.

## Why

With WAL and `NORMAL`, a commit is durable once it is in the WAL file. A Daemon crash or kill therefore loses nothing that was acked: the ack ("intent recorded") is only sent after the transaction commits. Only an OS crash or a power loss can roll back the last few commits, and the database stays consistent when that happens.

`FULL` would fsync the WAL on every commit. That roughly doubled the cost of a small commit, and small commits are most of what the store writes (one per Harness item, approval or state change).

## Considered Options

- **`synchronous = FULL`.** Survives power loss too. Rejected for the cost: a Host losing power also loses the Harness processes and their in-flight Turns, which recovery already handles (they end Interrupted and the user continues them).

## Consequences

- After a power loss a Client may hold a sequence the Daemon no longer has. The Client's resume already handles a Daemon that is behind it: it takes a fresh snapshot.
- Revisit if the Daemon ever records something that cannot be rebuilt or redone by the user after a power loss.

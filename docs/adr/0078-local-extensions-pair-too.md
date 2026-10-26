---
status: accepted
---

# Local Extensions pair too

## Context

Any process running as the user can open `~/.polaris/daemon.sock` with a Client's full power, so
a token on the socket adds no security against a hostile local process.

## Decision

Every Extension, local or not, presents a Pairing's token in `hello`; the Daemon scopes the
connection to its Grant and records the Pairing as the actor of what it does. Clients without a
token keep full power.

## Consequences

- The Session's history says which Extension approved or sent what, and one Extension can be
  revoked without touching the others.
- The token is a record of intent and a bound on mistakes, not a sandbox.

The connection's first request fixes its role. Token-less requests, including requests before
`hello`, establish a Client; a token-bearing `hello` reserves an Extension before asynchronous
authentication. A Client cannot become an Extension, and an Extension cannot change Pairing.
Every presented token is authenticated. Invalid tokens and attempted role changes seal the
connection, flush a typed refusal when possible, and close it. A transport exposed beyond the
trusted local socket must opt into `extensionTokenRequired` before accepting requests.

Revocation persists the revoked Pairing and closes its transports in one uninterruptible
operation. Cancelling the caller cannot leave revoked connections or subscriptions open.

An Extension sending a Turn into an existing Session that approves for itself needs `approve`
as well as `turn`: this covers `SendTurn`, `Steer`, `Continue` and `Retry`. The decider reads the
current permission mode inside the EventStore commit, so a queued request cannot rely on an
earlier supervised mode. `SetPermissionMode` and `SetModel` remain Client-only. A missing
`approve` is a durable `NotGranted` refusal and commits no events or Harness work.

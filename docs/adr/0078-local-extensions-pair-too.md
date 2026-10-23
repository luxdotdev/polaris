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

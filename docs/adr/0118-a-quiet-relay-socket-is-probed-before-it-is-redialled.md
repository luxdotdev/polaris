---
status: accepted (ENG-968)
amends: ADR 0084
---

# A quiet relay socket is probed before it is redialled

## Context

ADR 0084 redials the device's shared relay socket when a handshake times out, or a session
closes, with nothing heard on the socket since. Silence was taken to mean a dead socket. But a
Host that refuses a handshake also answers nothing: it never tells an unknown or not yet
vouched-for claim apart from noise (ADR 0112). A device signed in to two Accounts has a session
as each on one socket. When the Host had not yet read the second Account's device list, that
Account's handshake timed out, the socket was redialled, and the first Account's live session
ended with it ("the Daemon closed the connection", ENG-968). The `listening === 0` guard on the
close path didn't cover the handshake path, and on a socket that was really dead it left a
session with another Account's handshake in flight holding a dead socket.

## Decision

- A session that finds its socket quiet calls `RelaySocket.suspect`, which sends the relay an
  empty forward to the device's own address. The relay always answers it with `unreachable`
  (two devices never reach each other), so it costs one frame and wakes no Host.
- The socket is redialled only when nothing at all arrives within 3 s of the probe going out.
  One probe runs at a time; a reconnect ends it.
- The `listening === 0` guard goes: whether other sessions share the socket no longer matters,
  as a socket that answers its probe is kept and one that doesn't is dead for all of them.

## Consequences

A Host refusing one Account's handshake no longer ends another Account's session on the same
device. A socket that died silently is found 3 s later than before. The relay's contract now
documents the probe, and its contract suite checks it.

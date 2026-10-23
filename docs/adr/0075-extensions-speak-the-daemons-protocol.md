---
status: accepted
---

# Extensions speak the Daemon's own protocol

## Context

0.3.0 adds Extensions: outside programs (a Raycast extension, an Even Realities G2 app) that
read and drive Daemons. The Daemon's only listener was a Unix socket carrying `DaemonRpcs`
(effect/rpc over length-prefixed frames). A phone WebView can't reach a Unix socket, so
Extensions need a network surface. even-terminal, Even's own bridge, uses a small REST + SSE API.

## Decision

Extensions use the same `DaemonRpcs`, over a WebSocket on loopback for network Extensions and
over the socket for local ones, filtered by their Pairing's Grant. There is no separate REST API.
The published SDK (`packages/sdk`, protocol bundled) is the public surface; the protocol stays
internal.

## Consequences

- One protocol to specify, test and version; the Mobile App can use the same gateway.
- Every new RPC needs a Grant mapping, or Extensions can't call it.
- Breaking protocol changes reach Extensions; the SDK declares its oldest protocol version and
  the Daemon refuses a mismatch with a message saying which side to update.

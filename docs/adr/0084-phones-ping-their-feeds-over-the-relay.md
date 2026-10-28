---
status: accepted
amends: ADR 0080
---

# Phones ping their feeds over the Polaris Relay

## Context

`connectRpc` pings a Daemon only while a non-stream request is awaited, so an idle Daemon is
never woken; an open subscription relies on its transport to notice a dead peer (the Unix
socket's close, ssh's own keepalive). The Relay route has no such signal. The relay's WebSocket
pings are answered by the platform and never reach JavaScript, and a Daemon ends a
DeviceSession without telling the phone. When the phone's path dies without a close (iOS
suspends the app, the network changes), the connection still reads Connected and its host and
session feeds never deliver again; only a new request (leaving and re-entering a thread)
surfaces it (ENG-484).

## Decision

- A connection may ask for `keepAliveStreams`: it then pings while a stream is open too, and
  a peer that stops answering fails every call and stream, so the feeds resubscribe and resume.
  The Mobile App asks for it on every Host, every 15 s.
- Coming back to the front, the Mobile App asks each live connection for a pong (`checkAlive`)
  and drops one that doesn't answer within 5 s, rather than waiting for the next ping.
- A relay session whose handshake times out, or that closes after hearing nothing on its
  socket, recycles the shared relay socket (`RelaySocket.recycle`): a WebSocket that died
  silently would otherwise carry every later handshake into the void.

## Consequences

A foregrounded phone wakes its Hosts' Daemons every 15 s with one small ping; it is an active
Client, and iOS suspends its JavaScript in the background, so the cost stops there. The Desktop
App and Extensions keep the old behaviour, so the `idle` bench scenario is unchanged.

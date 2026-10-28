---
status: proposed
amends: ADR 0076
---

# Linked Devices reach Hosts through the Polaris Relay

## Context

The Mobile App must continue Desktop App sessions from anywhere, including from Hosts the user
keeps off their tailnet on purpose, so ADR 0076's Tailscale-only route is not enough. iOS push
also needs an APNs provider key that a Daemon cannot hold, which is why T3 Code's direct and
Tailscale connections get no background notifications.

## Decision

A Linked Device and each Daemon both dial out to the Polaris Relay, an open-source Bun + Effect
service that reuses `packages/protocol`'s frame codec and runs as a container (ours on Railway).
The Desktop App links the device once with a QR code that exchanges keys, so the Relay carries
only end-to-end encrypted frames and opaque "wake this device" pushes, and every Host the
Desktop App knows is shared to the device. The APNs key lives in Vercel KMS (imported ES256) and
is used from a Vercel Function beside `apps/site`. Remote Access becomes a per-Host choice of
route (Tailscale, the Relay); the Relay is opt-in per Host.

## Considered Options

- Tailscale only (ADR 0076): forces work machines onto a personal tailnet.
- Peer-to-peer with relay fallback (iroh): a native binding in the Daemon for a direct path
  that can be added later inside the same frame format.
- The user's own tunnel (Cloudflare Tunnel, ngrok): setup burden, still no push.
- Cloudflare Durable Objects for the Relay: cheaper idle sockets, but locks self-hosters to
  Cloudflare and cannot share the protocol package as directly.

## Consequences

- A Linked Device is a Client over the network, so ADR 0078's "token-less means Client" cannot
  apply: the Relay route authenticates the device's key before the Daemon grants Client power.
- The Daemon's outbound Relay connection keeps a keepalive and must justify it in the `idle`
  benchmark.
- APNs needs Apple's key ID as the JWT `kid`. Importing the `.p8` with `importKeyId` set to
  Apple's key ID makes it KMS's `kid` too, so `signJWT` (ttl 3600) gives a token APNs accepts
  and no `signMessage` fallback is needed (spike ENG-461, 2026-10-27). KMS is in beta.
- One issuer and Apple key per Vercel environment: production signs with a Sandbox & Production
  key and sends each device token to the endpoint the app reported; preview signs with a
  Sandbox-only key and refuses production tokens, so a preview deployment can never reach a
  production device (`apps/site/app/api/push/README.md`).
- The provider token is shared by every Function instance through the Upstash store and
  replaced every 55 minutes, under APNs' limits on token age and on how often it changes.
- Push payloads are sealed to the device with HPKE; the relay sees each wake's APNs token,
  size and timing but no content (`apps/relay/README.md`, Push).
- Extensions move onto the Relay later (Remote Access over the Relay for them too), once the
  pattern has settled.

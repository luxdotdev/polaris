---
status: accepted
---

# Tailscale is the only way in from the network

## Context

The G2 app runs in the Even app on a phone, often away from the Mac, and Even Hub expects HTTPS
origins listed exactly in the app's manifest. Extensions authenticate with bearer tokens. The
alternatives were a plain-HTTP listener on the LAN (even-terminal's default), public tunnels
(ngrok, bore), or Tailscale.

## Decision

The gateway listens only on `127.0.0.1`. Remote Access runs
`tailscale serve --bg --https=443 --set-path /polaris http://127.0.0.1:<port>`, which gives a
`https://<machine>.<tailnet>.ts.net/polaris` origin with an automatic certificate. The tailscale
module is adapted from T3 Code; it also finds the macOS app's bundled CLI.

## Consequences

- Tokens never cross a network in the clear, and nothing listens on the LAN.
- Remote Access needs Tailscale with HTTPS enabled for the tailnet; without it, only local
  Extensions work.
- `--set-path` shares port 443 with anything else the user serves (such as T3 Code).
- Machine names appear in Certificate Transparency logs, as with any Tailscale HTTPS.
- Remote Access proxies to a port, so it checks the port is this Daemon's before serving it:
  the gateway writes a fresh nonce to `~/.polaris/gateway.json` at every start and answers it on
  `GET /polaris/identity` (`apps/daemon/src/gateway/README.md`).

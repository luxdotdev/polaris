---
status: proposed
---

# Host addresses travel in the Polaris protocol, not over SSH forwarding

## Context

A Browser on one machine must open Host addresses (`localhost`, `*.localhost` such as Portless
apps, loopback IPs) on another. The SSH transport clears all forwardings by design, and Hosts
are also reached over WSL, Windows pipes, and later the Polaris Relay for Linked Devices.

## Decision

The Browser's Workspace partition proxies Host addresses only to a SOCKS5 server in the Desktop
App's main process. Chromium never consults a PAC script for loopback, `<-loopback>` or not, so
the partition uses fixed proxy rules: everything to the SOCKS server, `<-loopback>`, and a bypass
list that is the complement of the Host addresses (glob rules for every other name, CIDR rules for
every non-loopback IP), so other URLs still load directly with Chromium's own TLS. A name the list
misses (one ending in a digit) reaches the SOCKS server, which connects it directly. Each SOCKS connection becomes a byte stream in the Polaris protocol that the Daemon
opens to its own loopback, passing the hostname through unresolved so Portless can route by
SNI and Host header. The page keeps its origin (`localhost:3000`, `https://app.localhost`), so
cookies, OAuth redirects and HMR WebSockets keep working. A Host address accepts any TLS
certificate: its bytes travel only over Polaris's authenticated link and the Host's loopback.

## Considered Options

- A PAC script sending Host addresses to the SOCKS server: Chromium resolves loopback `DIRECT`
  before any PAC script runs (checked in Electron 44).
- SSH dynamic forwarding (`-O forward -D`) on the private ControlMaster: a free SOCKS5 proxy,
  but SSH Hosts only, and it reverses the "no forwardings" stance of `packages/client/src/ssh.ts`.
- Rewriting Host addresses to local forwarded ports: changes the origin and breaks cookies and
  OAuth redirects.
- Trusting each Host's dev CAs (Portless, mkcert) in the partition: tool-specific, and adds
  nothing on this path.

## Consequences

- Page traffic shares the Client's connection to the Daemon with RPC frames; a large HMR
  reload must be benchmarked for head-of-line delay before this ships.
- The same stream carries over to the Polaris Relay when the Mobile App gets a Browser.
- Non-Host URLs in a remote Host's partition skip the system proxy, as PAC `DIRECT` would.
- Names a Host's `/etc/hosts` maps to loopback (Portless `.test`, custom domains) are not Host
  addresses yet.

---
status: accepted
fixes: Add account did nothing behind a corporate proxy with TLS inspection (Zscaler)
---

# The main process reaches the internet through Chromium's network stack

## Context

A tester on Windows behind Zscaler (a proxy plus TLS inspection, its root
certificate in the Windows certificate store) clicked Settings → GitHub
accounts → Add account and nothing happened. The main process asked
`github.com/login/device/code` for a device code with Node's global `fetch`
(undici), which ignores the system proxy (PAC, WPAD, the Windows and macOS
proxy settings) and trusts only Node's bundled CA list, never the OS store.
The request failed, the renderer fired the request with `void`, and the poll
loop treated any transport error as `authorization_pending`.

## Decision

Every internet request from the main process goes through Electron's
`net.fetch` (`apps/desktop/src/main/net.ts`, `internetFetch`): GitHub (REST,
GraphQL, the device flow; Enterprise hosts too), the Windows update preflight,
and the price lists. Chromium resolves the system proxy, including PAC and
WPAD, uses integrated proxy auth (Negotiate, NTLM), and verifies certificates
against the OS store, so a security tool's root certificate installed there
is trusted. An oxlint `no-restricted-globals` override on `src/main` keeps the
global `fetch` out.

The injectable `Fetch` seam stays; tests pass fakes, the app passes
`internetFetch`.

Behaviour differences handled:

- `net.fetch` must be called after `app.whenReady`. Every caller is created in
  `start()`, which runs after it.
- `net.fetch` uses the default session's HTTP cache. GitHub answers
  `Cache-Control: private, max-age=60`, which would serve polls from cache, so
  `internetFetch` sends `cache: "no-store"` unless the caller sets `cache`. A
  caller's own `If-None-Match` still reaches GitHub and its 304 comes back.
- `redirect`, `signal` (abort and `AbortSignal.timeout`) and string bodies
  work as with Node's `fetch`; a 304 or 204 has a null body.
- Request headers are passed through as set (`User-Agent: Polaris` included).
- Errors reject with Chromium's net error (`net::ERR_PROXY_CONNECTION_FAILED`,
  `net::ERR_CERT_AUTHORITY_INVALID`), which sign-in uses to tell a network
  failure from an untrusted certificate.

Not changed: `protocol.ts` (serving `app://` from disk), loopback requests to
the Daemon and local model servers, and Markdown image previews
(`languages/media.ts`), which pin the socket to a validated public IP to
block requests to private addresses, something `net.fetch` can't do; those
previews still bypass a proxy.

Sign-in failures now show on the Add account card with the reason, and the
device flow retries a transport error three times (doubling the interval, at
most 30 s) before failing, while GitHub's own `authorization_pending` and
`slow_down` keep it waiting.

## Consequences

- A proxy that needs a username and password (Basic auth) still fails: main
  has no `login` handler for `net.fetch` requests, so Chromium cancels the
  challenge. Integrated auth works.
- Daemon-side downloads (language servers, the managed model, Daemon builds)
  run on the Host with Bun's `fetch` and are not covered here.

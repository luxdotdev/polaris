# Even G2 spike: a packaged build reaches a ts.net origin (ENG-406)

A throwaway Even Hub app that answers one question: can a packaged, privately uploaded build open a WebSocket to `wss://<mac>.<tailnet>.ts.net/...` when that origin is in `app.json`'s network whitelist? Adapted from even-realities/evenhub-templates@8cb0135 (`minimal`, MIT; see `ATTRIBUTION.md`).

It is a standalone package, not a Bun workspace: install it here.

## What it probes

On launch, and again on every tap, the app runs three probes and shows the result on the glasses and in the Even app's WebView:

| Probe | Target | Expected |
|---|---|---|
| `https` | `GET https://<host>/polaris-spike/hello` | `200 … polaris-spike ok` |
| `wss` | `wss://<host>/polaris-spike/ws`, one ping | an echo naming the `Origin` the server saw |
| `control` | `wss://ws.postman-echo.com/raw`, not whitelisted | fails if the whitelist is enforced |

The results, the WebView's `location.href` and its user agent are also POSTed to `/polaris-spike/report`, so the Mac's log shows them even if nobody reads the glasses. Double-tap exits.

## Run it

```bash
cd extensions/even-g2/spike
bun install
bun echo-server.ts                     # loopback :8787; logs to log/requests.jsonl
tailscale serve --bg --https=443 --set-path /polaris-spike http://127.0.0.1:8787
bun pack.ts <mac>.<tailnet>.ts.net     # writes polaris-g2-spike.ehpk
```

`pack.ts` bakes the host into the bundle and writes `build/app.json` with the whitelist `https://<host>` and `wss://<host>`; neither is committed.

The phone needs Tailscale connected, and the tailnet policy must let the phone reach the Mac on TCP 443 (`tailscale serve` listens there).

Upload and install:

1. `bunx evenhub login` once in a terminal (it refuses a non-TTY), or use the portal at hub.evenrealities.com.
2. `bunx evenhub create polaris-g2-spike.ehpk --name "Polaris G2 Spike" --tagline "Tailnet reachability spike"`.
3. `bunx evenhub promote 0.1.0 --to beta`, then `bunx evenhub testers add <your Even account email>` and accept the invitation.
4. Install the beta build from the Even app and open it on the glasses.

Clean up with `tailscale serve --https=443 --set-path /polaris-spike off` and stop the echo server.

## Findings (2026-10-23, iOS 18.7, G2, SDK 0.0.16, CLI 0.2.0)

- **Yes**: the packaged build reached `https://` and `wss://<mac>.<tailnet>.ts.net/polaris-spike/…` through `tailscale serve`: a 200 in 534 ms and an echo in 189 ms, confirmed in the Mac's log.
- **The whitelist isn't enforced for WebSockets**: the control socket to a host that isn't whitelisted echoed in 116 ms. Don't rely on it as a security boundary.
- **The app's origin is `http://127.0.0.1:<port>`**, with the port changing on each launch (55660, then 55722). The Daemon sees that as `Origin`, so it can't identify an extension by origin; pairing has to.
- `tailscale serve --set-path` strips the prefix: the backend sees `/hello` and `/ws`.
- **Two prerequisites to reach the Mac**: Tailscale connected on the phone, and a tailnet policy that lets the phone reach the Mac on TCP 443. When either is missing, the WebView reports only `TypeError: Load failed` and an error event.
- **`evenhub login` needs a TTY**, and the CLI has no token flag or environment variable. Other commands reuse `~/.config/evenhub/credentials.yaml` and refresh it themselves, rewriting the file.

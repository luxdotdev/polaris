# The gateway

The Daemon's second listener (ENG-399): `ServerRpcs` over a WebSocket on `127.0.0.1`, for Extensions (ADR 0075) and, through Tailscale, for Extensions away from the machine (ADR 0076). The Unix socket stays the Client's way in.

| File | What |
|---|---|
| `server.ts` | `startGateway`: `Bun.serve` on loopback; `GET /polaris/rpc` upgrades to a WebSocket, `GET /polaris/identity` answers the nonce; writes `gateway.json`; retries a busy port briefly, then runs without a gateway and says so. |
| `request.ts` | `admitRequest`: peer, path, method, Host and Origin checks before a request is served. |
| `transport.ts` | A server WebSocket as a ByteTransport (`GatewaySocketStream`), and the WebSocket handlers: no pings, no idle timeout, binary only. |
| `config.ts` | The port (`daemon.json`, `POLARIS_GATEWAY_PORT`, default 7477), the record (`gateway.json`), the nonce. |
| `client.testing.ts` | A WebSocket as a Client ByteTransport, for tests; the SDK has its own. |

## Contract

- URL `ws://127.0.0.1:7477/polaris/rpc`; behind Remote Access `wss://<machine>.<tailnet>.ts.net/polaris/rpc`, which `tailscale serve` proxies to `http://127.0.0.1:<port>/polaris` so the gateway still sees `/polaris/rpc` (ENG-400).
- The bytes are the socket's: binary WebSocket messages form one byte stream, framed by `packages/protocol/src/frame.ts`, in whatever pieces they arrive. The Wire, blobs in both directions and their limits are unchanged; `transport/server.ts` serves a gateway connection with the same `serveConnection` as a socket one, with `tokenRequired`. A text message closes the connection (1003).
- `hello` first, with an `extensionToken` and `protocolVersions: { min, max }`. A token-less `hello` fails with `ExtensionTokenRejected` (`missing`), any request before a successful `hello` is refused with `NotGranted`, and both close the connection after the error is flushed (ADR 0078, `extensions/admission.ts`). A range the Daemon's `PROTOCOL_VERSION` falls outside of, or none at all, fails `hello` with `ProtocolMismatch`, whose message says whether to update Polaris or the Extension; the connection stays open for a `hello` that fits.
- No pings from the Daemon and no idle timeout: an idle Extension must not wake an idle Daemon (the `idle` bench). A dead peer is noticed by the Wire's own ping, sent only while a reply is due, as over the socket.
- Close codes: 1000 after a Daemon-side close (a refusal, a revoked Pairing), 1001 when the Daemon stops, 1003 for a text message.

## Who gets in

The token in `hello` is the real check; the request checks keep browsers out, since a page can open a WebSocket to loopback:

- **Host** must be `127.0.0.1`, `localhost` (any port) or end in `.ts.net`: a page that resolved its own name to 127.0.0.1 (DNS rebinding) names itself. Tailscale serve passes the original Host, so the serve name passes.
- **Origin** absent (an SDK outside a browser) or `http://127.0.0.1:<port>`: the Even app's WebView, whose port changes every launch (ENG-406). Anything else is a browser page and is refused.
- The peer must be loopback (the listener binds it anyway). `X-Forwarded-*` headers are not read: nothing needs them, and only loopback could send them.

## Identity

Remote Access proxies tailnet traffic to `127.0.0.1:<port>`; if the gateway were not running, whatever listened there would receive the phone's tokens. So every start writes a fresh nonce (32 random bytes, base64url) into `~/.polaris/gateway.json` as `{ port, nonce }` (mode 0600, directory 0700, written atomically, removed on stop), and `GET /polaris/identity` answers `{ nonce }` and nothing else, with no authentication. Remote Access compares the two before `tailscale serve` and in its status (ENG-400).

## Settings

`~/.polaris/daemon.json` is the Daemon's settings file; `{ "gateway": { "port": 7477 } }` is all it holds for now. `POLARIS_GATEWAY_PORT` overrides it (dev Daemons side by side; `0` asks for an ephemeral port, what tests and the benches use). A port that cannot be bound after three retries leaves the Daemon running without a gateway and a `no gateway:` warning in its log; `gateway.json` is then absent.

## Tests

`request.test.ts` (the checks), `config.test.ts` (settings, record, nonce), `transport.test.ts` (a 1 MiB blob there and back through the real listener, a text frame), `gateway.test.ts` (end to end against `startServer`: token and range required, mismatch messages, an Extension's Grant and actor, revoke cutting the connection, browsers refused, the identity nonce, 1001 on stop).

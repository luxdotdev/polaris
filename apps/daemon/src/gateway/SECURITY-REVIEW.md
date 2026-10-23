# Gateway security review (ENG-399)

RB reviewed B at `306c3fe532a13e59a2537e2ef5a3b68d7adf06bf`, including accepted ADRs 0075, 0076 and 0078. This review covers loopback request admission, Extension authentication and version negotiation, identity proof, and transport resource bounds. It does not claim resistance to a hostile process running as the same OS user: that process can already use the trusted local socket (ADR 0078).

## Fixed

| Finding | Result and regression evidence |
|---|---|
| The public identity nonce could be fetched and later replayed by a replacement listener. | A private per-start 32-byte secret signs fresh verifier challenges; only the MAC is public. GET is refused. `identity.test.ts` checks exact decoded-byte HMAC, fresh-challenge mismatch, replayed-response refusal, canonical inputs, body limits and CORS absence. The new identity tests failed against B's GET endpoint before the change. |
| Token authentication installs the Pairing before protocol negotiation; a refused version still had its Grant. | The gateway gate now requires `protocolReady`, set only after successful hello validation. A granted read RPC after a mismatch is refused, then works after a compatible hello. The regression failed against B because the read succeeded. The Quint model tracks negotiation separately. |
| WebSocket `pause()` was a no-op and `readEvents` kept accumulating chunks. | An explicit bounded queue counts messages and bytes, closes with 1009 on overflow and releases pending input. The stalled-consumer test timed out against B and closes promptly with the fix. Real WebSocket tests separately exceed the message and queued-byte caps. |
| Unauthenticated sockets could hold partial frames indefinitely and pre-offer the socket Wire's large blobs. | A ten-second successful-hello deadline and cumulative 64 KiB pre-hello budget close incomplete/oversized handshakes. The deadline is cleared only after success; a real authenticated idle connection still answers after the incomplete peer expires. |
| Connections and reconnecting token guesses had no gateway admission budget. | Sixteen simultaneous WebSockets, a bounded connection queue, and lazy token buckets for upgrade attempts and identity requests. Tests exercise refusal, released capacity and refill. Tokens themselves remain 256 random bits with indexed SHA-256 lookup; rejected tokens seal and close their connection. |
| The gateway inherited 512 MiB per-blob and 1 GiB buffered-blob limits. | Gateway-only limits are 16 MiB per blob, 32 MiB buffered blobs, 1 MiB outgoing JSON, and ten-second blob inactivity/unclaimed retention. A real mounted gateway accepts 9,600,000 bytes and rejects 17 MiB; the test handler consumes blobs locally and calls no voice provider. |
| Temporary record reuse could retain old permissions or follow a stale temporary path. | The atomic writer now exclusively creates an unpredictable 0600 temporary file in the 0700 directory. Record tests check permissions, replacement, invalid/legacy records and removal. |

## Reviewed boundaries

The listener explicitly binds `127.0.0.1`; its request check also rejects known non-loopback peers. Host permits loopback names and `.ts.net` names, never arbitrary DNS names. Origin permits absence or the exact serialized `http://127.0.0.1[:port]` origin required by the Even WebView. Userinfo, paths and fragments now fail that Origin check. Browser-controlled Host/Origin values are checked before serving either route. No CORS headers are emitted, OPTIONS is refused, and no X-Forwarded header is used as identity or authority.

A gateway requires an Extension token; pre-hello RPCs cannot become a trusted Client. Invalid, unknown and revoked tokens close the connection. The tests retain role, Grant, revocation and typed protocol-mismatch coverage. Version negotiation does not grant authority merely because a token was valid. HTTP identity has no RPC privileges.

WebSocket per-message compression and pings remain disabled. Post-authentication idle sockets have no expiry timer. Rate buckets refill only when a request arrives. Identity body deadlines and pre-hello deadlines are one-shot and cleared on completion/close. HTTP idle timeout is separate from WebSocket idle behavior.

## Remaining limits and follow-up

[ENG-418](https://linear.app/luxdev/issue/ENG-418/bound-shared-wire-metadata-and-rpc-concurrency-for-hostile-paired) now bounds these shared Wire/RPC paths: 128 incoming blob entries on a gateway connection (1,024 on a default Wire), independently of bytes, and 32 RPC reservations per Extension connection / 128 across the server. Pending consumers and completed/failed blobs count too. Excess IDs or requests close the peer without creating an unbounded rejection queue. Both token-bearing local sockets and gateway connections share the RPC budget; the Desktop App's token-less socket does not. Streams retain their slots, while Ack/Interrupt remain available at capacity. Disconnect retains reservations until active handler cleanup finishes. The focused tests use isolated listeners, real Wire/RPC code and locally blocked handlers, never the user's live Daemon or a provider.

Bun owns sockets and request headers before `fetch`; the gateway has no application-level global raw TCP cap. HTTP's ten-second idle timeout and identity's five-second total body deadline reduce stalled work, but do not prove a total deadline for trickled headers or prevent OS descriptor exhaustion. [ENG-421](https://linear.app/luxdev/issue/ENG-421/bound-gateway-tcp-connections-before-bun-parses-request-headers) tracks admission before HTTP parsing. The fixed global admission budgets can be exhausted to deny new connections; they preserve bounded allocation rather than guaranteeing availability under sustained attack. Tailscale ACLs remain the remote network boundary.

BW checked the installed `bun-types@1.4.2` ServeOptions and [Bun's server documentation](https://bun.com/docs/runtime/http/server): `idleTimeout` measures inactivity, and no raw `maxConnections` or absolute header-deadline option is exposed there. `bun apps/daemon/src/gateway/rawHeaders.probe.ts` runs a bounded probe against its own ephemeral gateway, cleans up every socket, and prints the runtime version and timing. On Bun 1.4.4/macOS arm64, 32 incomplete HTTP connections were simultaneously open despite the 16-WebSocket cap. With one byte per second in an incomplete header value, all 32 closed around 12.02 seconds. This observed parser behavior is not a portable total-deadline guarantee. No OS descriptor exhaustion test or network proxy replacement was attempted.

Challenge-response proves that the endpoint answering this challenge knows the secret at that moment. C must choose a fresh challenge on every check and compare its expected MAC in constant time. It does not prevent port replacement after verification or a relay to the actual gateway. Secret exposure to same-user processes is outside this boundary.

No live Tailscale proxy, physical phone, Windows Host, privileged port exposure, or OS-level exhaustion test was run in RB. Tests use loopback listeners, real Daemon RPC/Wire code, temporary records/stores and a local fake voice consumer. Benchmark evidence is qualified by shared-host load; see the Claim for commands and counts.

## BW performance measurements (ENG-418)

On 2026-10-23, BW ran `bun run bench idle sessions --runs 3 --compare packages/bench/baselines/mac14-13-apple-m2-max-12c.json` before changes and after final validation stopped. This exercises real Daemon and Client runtime traffic, including 50 Agent Sessions, three Turns each and four token-less Clients. It does not measure Electron rendering or a physical phone. All heavy-session traffic completed without RPC admission failures.

| Measurement | Before | Final |
|---|---:|---:|
| Background CPU at start (cores) | 9.1 | 12.0 |
| No-Client wakeups per second | 0.667 | 0.733 |
| No-Client CPU over bare (%) | 0.005 | 0.007 |
| Four-Client delta latency p50 (ms) | 3.275 | 2.494 |
| Four-Client delta latency p99 (ms) | 48.779 | 26.284 |
| Four-Client dispatch acknowledgement p50 (ms) | 17.320 | 18.522 |
| Four-Client deltas per second per Client | 2,113.953 | 2,189.689 |
| Burst deltas per second | 130,216.699 | 210,169.824 |

Both comparisons exited 1: before had nine committed-baseline regressions; final had five. Final idle measurements passed the committed baseline, but the sessions failures remain: 50-session dispatch acknowledgement p50 (12.70 → 24.70 ms), dispatch-to-event p50 (11.59 → 21.29 ms), dispatch-to-event p99 (30.31 → 49.64 ms), event latency p99 (34 → 58 ms), and repeated-phase RSS growth (-4.94 → 7.28 MiB). Comparing final against the fresh before run also fails six existing tolerances: idle Client RSS, idle no-Client RSS, 50-session acknowledgement p50, final RSS, RSS growth and repeated-phase RSS growth. These runs do not establish unchanged performance or isolate the patch's cost on a quiet Host. No baseline or tolerance was changed.

An intermediate run overlapped BW's full validation, reported 25 regressions and is retained as unsuitable for performance attribution. Local result directories under `packages/bench/results/` are `2026-10-23T19-25-49-610Z` (before), `2026-10-23T19-34-41-884Z` (overlapped), and `2026-10-23T19-55-53-552Z` (final). Quiet-Host performance acceptance remains open in [ENG-423](https://linear.app/luxdev/issue/ENG-423/resolve-bw-session-benchmark-failures-with-controlled-host).

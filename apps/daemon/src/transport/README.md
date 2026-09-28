# Daemon transport

The Daemon's only listener, the RPC server on it, and `polaris bridge`. Decisions: ENG-175 (wire) and ENG-179 (SSH bridge, lifecycle).

| File | What |
|---|---|
| `server.ts` | `startServer`: lock, socket, `RpcServer` for `ServerRpcs`, one Wire per connection. Handler layers are composed here. |
| `rpcs.ts` | `ServerRpcs` = `DaemonRpcs` + the server-only `ConnectionBlobs` middleware. |
| `handlers.ts` | `hello` (HostInfo, capabilities; annotates the connection with the device label and the Client's capabilities) and placeholders for every other RPC. |
| `socket.ts` | Stale-socket probe, private socket directory, `Bun.listen` bound atomically, upgrade adoption. |
| `bunSocket.ts` | Bun sockets (listened or adopted by fd) as ByteTransports, with partial-write handling. |
| `lock.ts` | Single-instance lock. |
| `hostInfo.ts` | `HostInfo`, with a stable `hostId` in `~/.polaris/host-id`. |
| `bridge.ts` | `polaris bridge`: stdio ⇄ socket, byte for byte. |
| `serve.ts` | `polaris serve`: `startServer` with `upgrades: true` until SIGINT / SIGTERM. |

The framing and blob channel live in `packages/protocol/src/wire.ts` (shared with the Client): each RPC message is one JSON frame serialized with `RpcSerialization.json`; blobs are kind-1 frames. The writer drains queued JSON before each blob chunk and round-robins between blobs, so a large read never holds up a stream by more than one 256 KiB chunk. Limits (per connection): 512 MiB per blob, 1 GiB buffered, 60 s without progress fails a `take`, unclaimed blobs expire after 5 minutes; stream-sourced outgoing blobs buffer at most 4 chunks.

## Mounting handler layers

`startServer({ handlers })` takes any layer of RPC handlers, built from `DaemonRpcs`, `ServerRpcs` or a sub-group (`RpcGroup.make(...).toLayer`, `toLayerHandler`). Handlers are keyed by RPC tag, so they plug into `ServerRpcs` whichever group built them; any RPC not covered falls back to the placeholder. In `serve.ts`:

```ts
export const daemonHandlers = Layer.mergeAll(
  EngineRpcHandlers,                                   // dispatch, subscribeHost, subscribeSession
  FilesRpcsLive.pipe(Layer.provide(FileSearchLive())),
  GitRpcsLive,
  AttachmentRpcsLive,
  TerminalRpcsLive,
).pipe(Layer.provide(/* Engine, store, AttachmentStore, … */))
```

and add their capabilities with `startServer({ capabilities: [...] })` (the transport announces `blobs`).

**BlobChannel is per connection.** Every RPC in `ServerRpcs` carries the `ConnectionBlobs` middleware, which provides the calling connection's `BlobChannel` around each request; handlers read it with `yield* BlobChannel` inside the handler (not while the layer is built). A handler layer that lists `BlobChannel` as a requirement is satisfied at build time by a placeholder that dies if used outside a request, so `startServer` removes `BlobChannel` from the requirements. `transport.test.ts` runs `GitRpcsLive`'s `git.diff` through it.

**Device label.** `hello` calls `client.annotate(DeviceLabel, deviceLabel)` on the connection, so `dispatch` (engine) records which device resolved an approval.

## Single instance, stale sockets, upgrades

- `~/.polaris/daemon.lock` is created with `O_EXCL` and holds the pid. A lock whose pid is dead is stale and is taken over; a lock with no pid yet is honoured for 2 s (another Daemon mid-start). The lock naming this very process but not held by it was inherited across an execve upgrade and is kept.
- Then the socket is probed: if something answers, another Daemon is running (exit 75 from `polaris serve`); a dead socket file is removed. The directory is made 0700, the socket is created under umask 0177 (0600).
- `startServer({ upgrades: true })` (what `serve` does) wires in `service/upgrade.ts`: `adoptListener` on startup (then the probe is skipped: the old listener still accepts), `bindAtomically` for every bind, `adopt` drains connections queued on the inherited listener through `connectFd`, and `serveUpgrades` gets the listener fd.
- `daemon.lock` vs `daemon.pid`: the lock is the single-instance guard; `daemon.pid` (written by `serveUpgrades`) is the upgrade signal target. Only the lock holder writes the pid file, so both always name the same process; both survive the execve (same pid) and are removed on a clean exit. Merging them (pointing `upgradeFiles().pid` at `paths().lock`) would be a one-line change in `service/upgrade.ts` if we want one file.

## Bridge

`polaris bridge` connects to `paths().socket` and pipes stdin → socket and socket → stdout with backpressure. Bytes that arrive before the socket connects are buffered. It exits 0 when either side closes. When nothing listens and `~/.polaris/bin/polaris-supervise` exists (the fallback supervisor on Linux without systemd --user, which nothing may have started since a reboot), it starts the supervisor detached, waits up to 5 s for the socket to accept, and connects once more; input the Client sent meanwhile stays buffered. Otherwise, or if the Daemon does not come up, it exits `BRIDGE_EXIT_NO_DAEMON` (69) with a one-line stderr reason, which the Client shows as Needs Attention. `bridge.test.ts` runs the bridge as a process (`fixtures/bridge.ts`) against a stand-in supervisor. With agent forwarding on, it points `~/.polaris/agent.sock` at the forwarded `SSH_AUTH_SOCK` (atomic symlink swap), so the Daemon's long-lived processes have a stable agent path (`agentSocketPath()`).

## Bun quirks found here

- Under `bun test`, a `node:net` connect to a missing Unix socket fails the test even when its `error` event is handled; tests that need one run the code in a child process.
- Data that reaches a `node:net` socket before a `data` listener exists is dropped, and `drain` is not always emitted. Readers attach in the accept/open callback (`readEvents`), and writes also resolve on the write callback (`writeEvents`).
- `Bun.Socket#write` can accept part of a chunk; `bunSocket.ts` queues the rest until `drain`.

## Known gaps / TODO

- `daemonHandlers` in `serve.ts` is still `Layer.empty`; the lead wires the modules' layers (see above).
- No per-connection limit on concurrent requests or queued JSON beyond the Wire's 8 MiB high-water mark.
- `hello` does not reject old Clients; protocol-version negotiation is only on the Client side.
- The upgrade adoption path is exercised by `service/upgrade.test.ts` with its fixture, not end to end through `startServer`.
- `git/diff.ts` gets an `ArrayBuffer` from `Response#bytes()` where a `Uint8Array` is typed, so `countFiles` returns 0. The Wire now accepts any byte buffer, but the git module should wrap it in `new Uint8Array(...)`.

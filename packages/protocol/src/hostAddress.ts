/**
 * Host-address streams (ENG-613, ADR 0093): a Client opens one per SOCKS connection its
 * Browser makes to a Host address, and the Daemon connects to its own loopback. Framing and
 * flow control are in `byteStreams.ts`. Capability `host-address`.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { ByteCount, ByteStreamId } from "./byteStreams.ts";
import { Unsupported } from "./errors.ts";
import { BlobId } from "./ids.ts";

/** A TCP port on the Host's loopback. */
export const HostAddressPort = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 }));

/**
 * Why a Host-address stream could not open or stopped. `not-host-address`: the hostname is
 * not `localhost`, a `*.localhost` name or a loopback IP. `refused`, `unreachable`, `timeout`:
 * the loopback connect failed. `reset`: the open socket failed.
 */
export const HostAddressFailure = Schema.Literals([
  "not-host-address",
  "refused",
  "unreachable",
  "timeout",
  "reset",
]);

export type HostAddressFailure = typeof HostAddressFailure.Type;

export class HostAddressError extends Schema.TaggedError<HostAddressError>()("HostAddressError", {
  hostname: Schema.String,
  port: HostAddressPort,
  reason: HostAddressFailure,
  message: Schema.String,
}) {}

/** The stream is open: `downstream` carries the Host's bytes; `window` is the Daemon's. */
export const HostAddressOpened = Schema.Struct({
  streamId: ByteStreamId,
  downstream: BlobId,
  window: ByteCount,
});

export const HostAddressStreamItem = Schema.TaggedUnion({
  /** Always the first item. */
  Opened: HostAddressOpened.fields,
  /** The Daemon wrote `bytes` of `upstream` to the socket: the Client may send that many more. */
  Credit: { bytes: ByteCount },
});

export type HostAddressStreamItem = typeof HostAddressStreamItem.Type;

/**
 * Opens a byte stream to `hostname:port` on the Host's loopback. `hostname` travels
 * unresolved (`app.localhost`), so Portless can route by SNI and Host header; the Daemon
 * refuses any other name with `not-host-address`. The Client first offers `upstream`, the
 * blob of its bytes, and sends at most `window` of the Daemon's before a `Credit`; `window`
 * is what the Client will buffer of `downstream` before it grants `byteStream.credit`. The
 * RPC stream ends once both blobs have; ending it closes the socket.
 */
export const HostAddressOpen = Rpc.make("hostAddress.open", {
  payload: {
    hostname: Schema.String.check(Schema.isMinLength(1)),
    port: HostAddressPort,
    upstream: BlobId,
    window: ByteCount,
  },
  success: HostAddressStreamItem,
  error: Schema.Union([HostAddressError, Unsupported]),
  stream: true,
});

export class HostAddressRpcs extends RpcGroup.make(HostAddressOpen) {}

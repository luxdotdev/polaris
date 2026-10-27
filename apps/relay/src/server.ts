/**
 * The relay's WebSocket server on Bun.serve. It proves each party's key,
 * forwards data frames between linked parties by their header alone, and
 * holds nothing it forwards beyond the send call.
 */
import {
  type Auth,
  decodeClientControl,
  decodeDataFrame,
  encodeControl,
  encodeDataFrame,
  fromBase64Url,
  MAX_RECORD_BYTES,
  MAX_RELAY_MESSAGE_BYTES,
  NONCE_BYTES,
  RELAY_PATH,
  RelayAddress,
  RelayClose,
  RelayOp,
  authMessage,
  relayAddress,
  toBase64Url,
  verifyEd25519,
} from "@polaris/protocol/relay";
import { Match, Option, Predicate, Schema } from "effect";
import type { Server, ServerWebSocket } from "bun";
import type { RelayConfig } from "./config.ts";
import { type Endpoint, Hub } from "./hub.ts";
import { ConnectionGate, TokenBucket } from "./limits.ts";
import type { EmitWideEvent } from "./wideEvent.ts";

type Phase = "challenged" | "verifying" | "ready";

interface Connection {
  readonly id: string;
  readonly ip: string;
  readonly opened: number;
  readonly nonce: Uint8Array;
  readonly messages: TokenBucket;
  readonly bytes: TokenBucket;
  phase: Phase;
  endpoint: Endpoint | null;
  authTimer: ReturnType<typeof setTimeout> | null;
  endedBy: string;
  framesIn: number;
  bytesIn: number;
  framesOut: number;
  bytesOut: number;
  controlIn: number;
  unreachable: number;
  dropped: number;
}

type Socket = ServerWebSocket<Connection>;

export interface RelayHandle {
  readonly port: number;
  readonly connections: () => number;
  readonly stop: () => Promise<void>;
}

const SWEEP_INTERVAL_MS = 60_000;

const decodeAddress = Schema.decodeUnknownOption(RelayAddress);

const clientIp = (request: Request, server: Server<Connection>, trustProxy: boolean): string => {
  const forwarded = trustProxy ? request.headers.get("x-forwarded-for") : null;
  const first = forwarded?.split(",")[0]?.trim();

  return first !== undefined && first !== "" ? first : (server.requestIP(request)?.address ?? "");
};

const newConnection = (config: RelayConfig, ip: string): Connection => ({
  id: toBase64Url(crypto.getRandomValues(new Uint8Array(9))),
  ip,
  opened: performance.now(),
  nonce: crypto.getRandomValues(new Uint8Array(NONCE_BYTES)),
  messages: new TokenBucket(config.messagesPerSecond, config.messagesPerSecond * 2),
  bytes: new TokenBucket(config.bytesPerSecond, config.bytesPerSecond * 2),
  phase: "challenged",
  endpoint: null,
  authTimer: null,
  endedBy: "peer",
  framesIn: 0,
  bytesIn: 0,
  framesOut: 0,
  bytesOut: 0,
  controlIn: 0,
  unreachable: 0,
  dropped: 0,
});

/** Closes `ws` from the relay's side, recording why for its wide event. */
const end = (ws: Socket, code: number, reason: string) => {
  if (ws.data.endedBy === "peer") ws.data.endedBy = reason;
  ws.close(code, reason);
};

const endpointFor = (
  ws: Socket,
  auth: typeof Auth.Type,
  address: Endpoint["address"]
): Endpoint => ({
  address,
  role: auth.role,
  send: (message) => {
    const sent = ws.send(message);

    if (sent === 0) {
      ws.data.dropped++;

      return false;
    }

    if (!Predicate.isString(message)) {
      ws.data.framesOut++;
      ws.data.bytesOut += message.byteLength;
    }

    return true;
  },
  replace: () => end(ws, RelayClose.Replaced, "replaced"),
});

export const startRelay = (config: RelayConfig, emit: EmitWideEvent): RelayHandle => {
  const hub = new Hub();
  const gate = new ConnectionGate(config);

  const limits = {
    maxMessageBytes: MAX_RELAY_MESSAGE_BYTES,
    maxPeers: config.maxPeers,
    messagesPerSecond: config.messagesPerSecond,
    bytesPerSecond: config.bytesPerSecond,
    authTimeoutMs: config.authTimeoutMs,
    idleTimeoutSeconds: config.idleTimeoutSeconds,
  };

  const authenticate = async (ws: Socket, auth: typeof Auth.Type) => {
    const key = fromBase64Url(auth.key);
    const signature = fromBase64Url(auth.sig);
    const peers = auth.peers ?? [];

    const valid =
      Option.isSome(key) &&
      Option.isSome(signature) &&
      (auth.role === "host" || auth.peers === undefined) &&
      (await verifyEd25519(key.value, authMessage(ws.data.nonce, auth.role), signature.value));

    if (ws.readyState !== WebSocket.OPEN) return;

    if (!valid || !Option.isSome(key)) return end(ws, RelayClose.AuthFailed, "auth-failed");

    if (peers.length > config.maxPeers) return end(ws, RelayClose.BadMessage, "too-many-peers");
    const address = await relayAddress(key.value);

    if (ws.readyState !== WebSocket.OPEN) return;
    clearTimeout(ws.data.authTimer ?? undefined);
    ws.data.phase = "ready";
    ws.data.endpoint = endpointFor(ws, auth, address);
    ws.send(encodeControl({ t: "ready", address }));
    hub.attach(ws.data.endpoint, peers);
  };

  const onControl = (ws: Socket, text: string) => {
    ws.data.controlIn++;
    const message = decodeClientControl(text);

    if (Option.isNone(message)) return end(ws, RelayClose.BadMessage, "bad-control");
    const { phase, endpoint } = ws.data;

    Match.value(message.value).pipe(
      Match.discriminatorsExhaustive("t")({
        auth: (auth) => {
          if (phase !== "challenged") return end(ws, RelayClose.BadMessage, "auth-twice");
          ws.data.phase = "verifying";
          void authenticate(ws, auth);
        },
        peers: ({ peers }) => {
          if (endpoint?.role !== "host") return end(ws, RelayClose.BadMessage, "peers-not-host");

          if (peers.length > config.maxPeers)
            return end(ws, RelayClose.BadMessage, "too-many-peers");
          hub.setPeers(endpoint, peers);
        },
      })
    );
  };

  const onData = (ws: Socket, bytes: Uint8Array) => {
    const endpoint = ws.data.endpoint;

    if (endpoint === null) return end(ws, RelayClose.BadMessage, "data-before-ready");
    const frame = decodeDataFrame(bytes);
    const peer = Option.flatMap(frame, (f) => decodeAddress(f.peer));

    if (
      Option.isNone(frame) ||
      Option.isNone(peer) ||
      frame.value.op !== RelayOp.Forward ||
      frame.value.payload.byteLength > MAX_RECORD_BYTES
    )
      return end(ws, RelayClose.BadMessage, "bad-frame");
    ws.data.framesIn++;
    const target = hub.route(endpoint, peer.value);

    if (target === undefined) {
      ws.data.unreachable++;
      ws.send(encodeControl({ t: "unreachable", peer: peer.value }));

      return;
    }

    target.send(encodeDataFrame(RelayOp.Forward, endpoint.address, frame.value.payload));
  };

  const server = Bun.serve<Connection>({
    port: config.port,
    hostname: config.hostname,
    fetch(request, server) {
      const url = new URL(request.url);

      if (url.pathname === "/healthz") return new Response("ok");

      if (url.pathname !== RELAY_PATH) return new Response("Not found", { status: 404 });
      const ip = clientIp(request, server, config.trustProxy);
      const refusal = gate.admit(ip);

      if (refusal !== null) {
        emit({ event: "relay.refused", reason: refusal });

        return new Response(refusal, { status: refusal === "relay-full" ? 503 : 429 });
      }

      if (server.upgrade(request, { data: newConnection(config, ip) })) return undefined;
      gate.release(ip);

      return new Response("Expected a WebSocket upgrade", { status: 426 });
    },
    websocket: {
      maxPayloadLength: MAX_RELAY_MESSAGE_BYTES,
      idleTimeout: config.idleTimeoutSeconds,
      sendPings: true,
      backpressureLimit: config.backpressureLimitBytes,
      closeOnBackpressureLimit: true,
      publishToSelf: false,
      open(ws) {
        ws.data.authTimer = setTimeout(
          () => end(ws, RelayClose.AuthTimeout, "auth-timeout"),
          config.authTimeoutMs
        );
        ws.send(encodeControl({ t: "challenge", v: 1, nonce: toBase64Url(ws.data.nonce), limits }));
      },
      message(ws, message) {
        const size = Predicate.isString(message) ? Buffer.byteLength(message) : message.byteLength;
        ws.data.bytesIn += size;

        if (!ws.data.messages.take() || !ws.data.bytes.take(size))
          return end(ws, RelayClose.RateLimited, "rate-limited");

        if (ws.data.phase === "verifying") return end(ws, RelayClose.BadMessage, "early-message");

        if (Predicate.isString(message)) return onControl(ws, message);

        if (ws.data.phase !== "ready") return end(ws, RelayClose.BadMessage, "data-before-ready");
        onData(ws, message);
      },
      close(ws, code) {
        const data = ws.data;
        clearTimeout(data.authTimer ?? undefined);

        if (data.endpoint !== null) hub.detach(data.endpoint);
        gate.release(data.ip);
        emit({
          event: "relay.connection",
          conn: data.id,
          role: data.endpoint?.role ?? null,
          authenticated: data.endpoint !== null,
          durationMs: Math.round(performance.now() - data.opened),
          framesIn: data.framesIn,
          bytesIn: data.bytesIn,
          framesOut: data.framesOut,
          bytesOut: data.bytesOut,
          controlIn: data.controlIn,
          unreachable: data.unreachable,
          dropped: data.dropped,
          closeCode: code,
          endedBy: data.endedBy,
        });
      },
    },
  });

  const sweep = setInterval(() => gate.sweep(), SWEEP_INTERVAL_MS);
  sweep.unref();
  const port = server.port ?? config.port;
  emit({ event: "relay.start", port });

  return {
    port,
    connections: () => gate.connections,
    stop: async () => {
      clearInterval(sweep);
      await server.stop(true);
    },
  };
};

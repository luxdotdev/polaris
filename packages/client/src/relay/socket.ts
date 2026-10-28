/**
 * A Linked Device's socket to one Polaris Relay (apps/relay/README.md is the contract):
 * proves the device's relay key, tracks which Hosts are online, and hands each Host's
 * records to the sessions listening for them. Reconnects with backoff and full jitter
 * while it is wanted; idle, it sends nothing (the relay pings).
 */
import {
  decodeDataFrame,
  decodeRelayControl,
  encodeControl,
  encodeDataFrame,
  fromBase64Url,
  type RelayAddress,
  type RelayLimits,
  RelayOp,
  toBase64Url,
} from "@polaris/protocol/relay";
import { proveRelayKey, type RelayIdentity } from "@polaris/protocol/relay/party";
import { Option, Predicate } from "effect";
import { Pacer } from "./pacer.ts";

const BACKOFF_MIN_MS = 500;

const BACKOFF_MAX_MS = 30_000;

/** A WebSocket buffers what the network can't take yet; writers wait above this. */
const MAX_BUFFERED_BYTES = 1024 * 1024;

const jittered = (attempt: number) =>
  Math.random() * Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);

/** What a session hears about its Host on this socket. */
export interface PeerListener {
  readonly record: (record: Uint8Array) => void;
  /** The Host went offline, the relay dropped a forward to it, or this socket dropped. */
  readonly lost: (reason: string) => void;
}

export interface RelaySocketOptions {
  readonly url: string;
  readonly identity: RelayIdentity;
  /** Reconnect after a drop; a linking socket dials once. */
  readonly reconnect: boolean;
  /** For tests: a fixed backoff instead of the jittered one. */
  readonly backoff?: ((attempt: number) => number) | undefined;
}

export class RelaySocket {
  private ws: WebSocket | null = null;
  private ready = false;
  private stopped = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pacer: Pacer | null = null;
  private readonly online = new Set<string>();
  private readonly listeners = new Map<string, Set<PeerListener>>();
  private readonly waiters = new Set<() => void>();
  /** Why the last attempt ended, for a session that gives up waiting. */
  lastError = "not connected yet";

  constructor(private readonly options: RelaySocketOptions) {}

  get isReady(): boolean {
    return this.ready;
  }

  start(): void {
    if (this.stopped || this.ws !== null || this.timer !== null) return;
    this.dial();
  }

  stop(): void {
    this.stopped = true;

    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close();
    this.drop("the relay socket was closed");
  }

  /** True once the relay said `peer` is online on this socket, since the last connect. */
  isOnline(peer: RelayAddress): boolean {
    return this.online.has(peer);
  }

  /** Resolves on the next change: ready, a presence, or a drop. */
  changed(): Promise<void> {
    return new Promise((resolve) => this.waiters.add(resolve));
  }

  listen(peer: RelayAddress, listener: PeerListener): () => void {
    const set = this.listeners.get(peer) ?? new Set();
    set.add(listener);
    this.listeners.set(peer, set);

    return () => {
      set.delete(listener);

      if (set.size === 0) this.listeners.delete(peer);
    };
  }

  /** Sends records to `peer` in order, paced under the relay's rates; false when not ready. */
  async send(peer: RelayAddress, records: ReadonlyArray<Uint8Array>): Promise<boolean> {
    const ws = this.ws;
    const pacer = this.pacer;

    if (!this.ready || ws === null || pacer === null) return false;
    let sent = true;

    await pacer.enqueue(records, (record) => {
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) sent = false;
      else ws.send(encodeDataFrame(RelayOp.Forward, peer, record));
    });

    while (sent && this.ws === ws && ws.bufferedAmount > MAX_BUFFERED_BYTES)
      await new Promise((resolve) => setTimeout(resolve, 20));

    return sent && this.ws === ws;
  }

  private notify(): void {
    const waiters = [...this.waiters];
    this.waiters.clear();

    for (const wake of waiters) wake();
  }

  private lose(peer: string, reason: string): void {
    for (const listener of this.listeners.get(peer) ?? []) listener.lost(reason);
  }

  private drop(reason: string): void {
    const wasReady = this.ready;
    this.ready = false;
    this.pacer = null;
    this.online.clear();

    if (wasReady) for (const peer of this.listeners.keys()) this.lose(peer, reason);
    this.notify();
  }

  private dial(): void {
    const ws = new WebSocket(this.options.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;

      if (Predicate.isString(event.data)) this.control(ws, event.data);
      else if (event.data instanceof ArrayBuffer) this.data(new Uint8Array(event.data));
    };

    ws.onerror = () => {
      this.lastError = `could not reach the relay at ${this.options.url}`;
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;

      if (event.code !== 1000 && event.code !== 1006)
        this.lastError = `the relay closed the socket (${event.code} ${event.reason})`;
      this.drop(this.lastError);

      if (this.stopped || !this.options.reconnect) return;
      const delay = (this.options.backoff ?? jittered)(this.attempt++);
      this.timer = setTimeout(() => {
        this.timer = null;

        if (!this.stopped) this.dial();
      }, delay);
    };
  }

  private control(ws: WebSocket, text: string): void {
    const message = Option.getOrNull(decodeRelayControl(text));

    // Unknown or newer messages (e.g. host-only ones) are not the device's business.
    if (message === null) return;

    switch (message.t) {
      case "challenge":
        this.authenticate(ws, message.nonce, message.limits);
        break;
      case "ready":
        this.ready = true;
        this.attempt = 0;
        this.notify();
        break;
      case "presence":
        if (message.online) this.online.add(message.peer);
        else {
          this.online.delete(message.peer);
          this.lose(message.peer, "the Host went offline on the relay");
        }

        this.notify();
        break;
      case "unreachable":
        this.online.delete(message.peer);
        this.lose(message.peer, "the relay could not reach the Host");
        this.notify();
        break;
    }
  }

  private authenticate(ws: WebSocket, nonce: string, limits: RelayLimits): void {
    const bytes = Option.getOrNull(fromBase64Url(nonce));

    if (bytes === null) {
      ws.close();

      return;
    }

    this.pacer = new Pacer(limits);
    ws.send(
      encodeControl({
        t: "auth",
        role: "device",
        key: toBase64Url(this.options.identity.publicKey),
        sig: toBase64Url(proveRelayKey(this.options.identity, bytes, "device")),
      })
    );
  }

  private data(bytes: Uint8Array): void {
    const frame = Option.getOrNull(decodeDataFrame(bytes));

    if (frame === null) return;

    for (const listener of this.listeners.get(frame.peer) ?? []) listener.record(frame.payload);
  }
}

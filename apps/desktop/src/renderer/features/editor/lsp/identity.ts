import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { AuthenticatedLanguageIdentity, LanguageIdentityLookup } from "./lifecycle.ts";
import { bindLanguageIdentity } from "./bindings.ts";

const Identity = Schema.Struct({
  hostId: P.HostId,
  clientId: P.LanguageKey,
  connectionEpoch: P.LanguageCounter.check(Schema.isGreaterThan(0)),
});

/** Token/signal describe exact connection lifetime for freshness; they authenticate nothing. */
export interface RendererLanguageConnection {
  readonly token: object;
  readonly hostId: P.HostId;
  readonly signal: AbortSignal;
  readonly languages: boolean;
}

export interface LanguageIdentityPorts {
  readonly connection: (hostKey: string) => RendererLanguageConnection | null;
  /** Composition supplies only the independently authenticated Main identity IPC result. */
  readonly fetch: (
    hostKey: string,
    signal: AbortSignal
  ) => Promise<AuthenticatedLanguageIdentity | null>;
  readonly changed: () => void;
}

interface Entry {
  readonly connection: RendererLanguageConnection;
  readonly controller: AbortController;
  readonly abort: () => void;
  identity: AuthenticatedLanguageIdentity | null;
  pending: Promise<AuthenticatedLanguageIdentity | null>;
}

const sameConnection = (
  left: RendererLanguageConnection,
  right: RendererLanguageConnection | null
) =>
  right !== null &&
  right.languages &&
  !right.signal.aborted &&
  left.token === right.token &&
  left.signal === right.signal &&
  left.hostId === right.hostId;

/** Main identity is cached per current connection, with bounded on-demand requests and no polling. */
export class RendererLanguageIdentityCache {
  private readonly entries = new Map<string, Entry>();
  private readonly accepted = new Map<
    string,
    {
      readonly connection: RendererLanguageConnection;
      readonly identity: AuthenticatedLanguageIdentity;
    }
  >();
  private outstanding = 0;
  private disposed = false;
  readonly timeoutMs: number;

  constructor(
    readonly ports: LanguageIdentityPorts,
    timeoutMs = 5000
  ) {
    this.timeoutMs = Math.max(
      1,
      Math.min(30000, Schema.decodeUnknownSync(P.LanguageCounter)(timeoutMs))
    );
  }

  readonly lookup: LanguageIdentityLookup = (hostKey) => {
    const entry = this.entries.get(hostKey);

    if (entry === undefined || this.disposed) return null;

    if (!sameConnection(entry.connection, this.ports.connection(hostKey))) {
      this.invalidate(hostKey);

      return null;
    }

    return entry.identity;
  };

  refresh(hostKey: string): Promise<AuthenticatedLanguageIdentity | null> {
    const connection = this.ports.connection(hostKey);
    const previous = this.entries.get(hostKey);

    if (
      this.disposed ||
      connection === null ||
      !connection.languages ||
      connection.signal.aborted
    ) {
      this.invalidate(hostKey);

      return Promise.resolve(null);
    }

    if (previous !== undefined && sameConnection(previous.connection, connection))
      return previous.pending;
    this.invalidate(hostKey);

    if (
      this.entries.size >= 128 ||
      this.outstanding >= 32 ||
      (!this.accepted.has(hostKey) && this.accepted.size >= 128)
    )
      return Promise.resolve(null);
    const controller = new AbortController();

    const entry: Entry = {
      connection,
      controller,
      identity: null,
      pending: Promise.resolve(null),
      abort: () => {
        if (this.entries.get(hostKey) === entry) this.invalidate(hostKey);
      },
    };

    this.entries.set(hostKey, entry);
    connection.signal.addEventListener("abort", entry.abort, { once: true });
    entry.pending = this.request(hostKey, entry);

    return entry.pending;
  }

  private request(hostKey: string, entry: Entry): Promise<AuthenticatedLanguageIdentity | null> {
    this.outstanding++;
    const signal = AbortSignal.any([entry.connection.signal, entry.controller.signal]);

    return new Promise((resolve) => {
      let finished = false;

      const finish = (identity: AuthenticatedLanguageIdentity | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        resolve(identity);
      };

      const aborted = () => finish(null);

      const timer = setTimeout(() => {
        entry.controller.abort();
        finish(null);
      }, this.timeoutMs);

      signal.addEventListener("abort", aborted, { once: true });

      void Promise.resolve()
        .then(() => (signal.aborted ? null : this.ports.fetch(hostKey, signal)))
        .then((value) => {
          if (
            finished ||
            signal.aborted ||
            this.disposed ||
            this.entries.get(hostKey) !== entry ||
            !sameConnection(entry.connection, this.ports.connection(hostKey))
          )
            return finish(null);

          if (value === null) return finish(null);
          const identity = Schema.decodeUnknownSync(Identity)(value);
          const last = this.accepted.get(hostKey);

          if (
            identity.hostId !== entry.connection.hostId ||
            (last !== undefined &&
              (identity.connectionEpoch < last.identity.connectionEpoch ||
                (!sameConnection(last.connection, entry.connection) &&
                  identity.connectionEpoch === last.identity.connectionEpoch) ||
                (identity.connectionEpoch === last.identity.connectionEpoch &&
                  identity.clientId !== last.identity.clientId)))
          )
            return finish(null);

          entry.identity = Object.freeze(identity);
          this.accepted.set(hostKey, { connection: entry.connection, identity: entry.identity });
          this.ports.changed();
          finish(entry.identity);
        })
        .catch(() => finish(null))
        .finally(() => {
          this.outstanding--;
        });
    });
  }

  invalidate(hostKey: string) {
    const entry = this.entries.get(hostKey);

    if (entry === undefined) return;
    this.entries.delete(hostKey);
    entry.connection.signal.removeEventListener("abort", entry.abort);
    entry.controller.abort();
    this.ports.changed();
  }

  reconcile(hostKeys: readonly string[]) {
    const keys = new Set(hostKeys.slice(0, 128));

    for (const hostKey of this.entries.keys()) if (!keys.has(hostKey)) this.invalidate(hostKey);

    for (const hostKey of keys) void this.refresh(hostKey);
  }

  dispose() {
    this.disposed = true;

    for (const hostKey of this.entries.keys()) this.invalidate(hostKey);
    this.accepted.clear();
  }
}

export interface LanguageIdentityConstruction {
  readonly connection: LanguageIdentityPorts["connection"];
  readonly fetch: LanguageIdentityPorts["fetch"];
  readonly hostKeys: () => readonly string[];
  readonly subscribe: (changed: () => void) => () => void;
}

/** Joint composition supplies exact Main lookup and current connection lifetime ports. */
export const bindRendererLanguageIdentities = (ports: LanguageIdentityConstruction) => {
  let disposed = false;
  let unbind = () => {};

  const cache = new RendererLanguageIdentityCache({
    connection: ports.connection,
    fetch: ports.fetch,
    changed: () => {
      if (!disposed) unbind = bindLanguageIdentity(cache.lookup);
    },
  });

  unbind = bindLanguageIdentity(cache.lookup);
  const refresh = () => cache.reconcile(ports.hostKeys());
  const unsubscribe = ports.subscribe(refresh);
  refresh();

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    cache.dispose();
    unbind();
  };
};

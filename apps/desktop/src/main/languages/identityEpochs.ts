import {
  languageSessionAuthority,
  type HostConnection,
  type LanguageSessionAuthority,
  type LiveSession,
} from "@polaris/client";
import { Effect, Exit, SubscriptionRef } from "effect";

export interface MainLanguageIdentity {
  readonly hostId: LanguageSessionAuthority["identity"]["hostId"];
  readonly clientId: string;
  readonly connectionEpoch: number;
}

interface Registration {
  readonly connection: HostConnection;
  readonly session: LiveSession;
  readonly authority: LanguageSessionAuthority;
  readonly identity: MainLanguageIdentity;
  readonly onAbort: () => void;
}

const hasLanguageRoute = (capabilities: readonly string[]) =>
  capabilities.includes("languages") || capabilities.includes("languages.preview-media");

let nextEpoch = 0;

const epochs = new WeakMap<LiveSession, number>();

const retired = new WeakSet<LiveSession>();

const epochOf = (session: LiveSession): number | null => {
  const existing = epochs.get(session);

  if (existing !== undefined) return existing;

  if (nextEpoch >= Number.MAX_SAFE_INTEGER) return null;
  nextEpoch++;
  epochs.set(session, nextEpoch);

  return nextEpoch;
};

/** One Main registry instance; current must read actual HostDirectory/HostRegistry ownership. */
export class LanguageIdentityEpochs {
  readonly #registrations = new Map<string, Registration>();
  #disposed = false;

  constructor(readonly current: (hostKey: string) => HostConnection | null) {}

  #live(hostKey: string, session: LiveSession) {
    if (this.#disposed || retired.has(session)) return null;
    const authority = languageSessionAuthority(session);

    if (authority === null || !hasLanguageRoute(authority.capabilities)) return null;

    try {
      const connection = this.current(hostKey);

      if (connection === null || connection.key !== hostKey) return null;
      const live = Effect.runSyncExit(connection.session);
      const status = Effect.runSync(SubscriptionRef.get(connection.status));

      if (
        Exit.isFailure(live) ||
        live.value !== session ||
        status.state !== "connected" ||
        status.epoch !== authority.epoch ||
        status.host?.hostId !== authority.identity.hostId ||
        !hasLanguageRoute(status.capabilities)
      )
        return null;

      return { connection, authority };
    } catch {
      return null;
    }
  }

  /** Register only the current privately authenticated session, never public identity fields. */
  bind(hostKey: string, session: LiveSession): MainLanguageIdentity | null {
    const live = this.#live(hostKey, session);

    if (live === null) return null;
    const previous = this.#registrations.get(hostKey);

    if (previous !== undefined) {
      if (
        previous.connection === live.connection &&
        previous.session === session &&
        previous.authority === live.authority
      )
        return previous.identity;
      this.invalidate(hostKey);
    }

    const connectionEpoch = epochOf(session);

    if (connectionEpoch === null || retired.has(session)) return null;
    const identity = Object.freeze({ ...live.authority.identity, connectionEpoch });

    const onAbort = () => {
      if (this.#registrations.get(hostKey)?.session === session) this.invalidate(hostKey);
    };

    this.#registrations.set(hostKey, { ...live, session, identity, onAbort });
    live.authority.signal.addEventListener("abort", onAbort, { once: true });

    return identity;
  }

  /** Recheck independent current ownership at every IPC lookup and after each async wait. */
  lookup(hostKey: string): MainLanguageIdentity | null {
    const registered = this.#registrations.get(hostKey);

    if (registered === undefined) return null;
    const live = this.#live(hostKey, registered.session);

    if (
      live === null ||
      live.connection !== registered.connection ||
      live.authority !== registered.authority
    ) {
      this.invalidate(hostKey);

      return null;
    }

    return registered.identity;
  }

  /** Main calls this synchronously before removal/replacement, including an unobserved ABA. */
  invalidate(hostKey: string): void {
    const registered = this.#registrations.get(hostKey);

    if (registered === undefined) return;
    this.#registrations.delete(hostKey);
    retired.add(registered.session);
    registered.authority.signal.removeEventListener("abort", registered.onAbort);
  }

  dispose(): void {
    this.#disposed = true;

    for (const hostKey of this.#registrations.keys()) this.invalidate(hostKey);
  }
}

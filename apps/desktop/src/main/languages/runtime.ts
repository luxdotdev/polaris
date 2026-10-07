import {
  LanguageAccess,
  decodeLanguage,
  languageSessionAuthority,
  languageTransportFor,
  type HostConnection,
  type LiveSession,
} from "@polaris/client";
import * as P from "@polaris/protocol";
import { Deferred, Effect, Predicate, Schema, Stream } from "effect";
import type { LanguageApi } from "../../shared/api.ts";
import {
  LanguageRequestInputs,
  type LanguageRequestInput,
  type LanguageRequestMethod,
} from "../../shared/languages.ts";
import { languageFor } from "../../renderer/features/editor/model/language.ts";
import { associatedLanguage } from "../../renderer/features/editor/lsp/configuration.ts";
import { HostDirectory, type ClientRuntime } from "../hosts.ts";
import { createLanguageBridge, LanguagePreferences, type LanguageHost } from "./index.ts";
import { LanguageRegistrations } from "./registrations.ts";
import type { LanguageIdentityEpochs } from "./identityEpochs.ts";

interface HostBinding {
  readonly connection: HostConnection;
  readonly session: LiveSession;
  readonly host: LanguageHost & { readonly access: LanguageAccess };
  readonly controller: AbortController;
}

export interface MainLanguageOptions {
  readonly runtime: ClientRuntime;
  readonly preferences: LanguagePreferences;
  /** Main allocates monotonically across exact authenticated connection lifetimes. */
  readonly identities: LanguageIdentityEpochs;
}

const failure = {
  code: "LanguageError",
  message: "Language connection unavailable",
  languageError: Schema.encodeSync(P.LanguageError)(
    new P.LanguageError({
      reason: "not-connected",
      message: "Language connection unavailable",
      retryable: true,
    })
  ),
};

const unavailable = () =>
  new P.LanguageError({ reason: "not-connected", message: failure.message, retryable: true });

const globalPreference = (
  method: LanguageRequestMethod,
  input: LanguageRequestInput<LanguageRequestMethod>
) => {
  if (method !== "languages.settings.get" && method !== "languages.settings.set") return false;
  const { scope } = decodeLanguage(LanguageRequestInputs["languages.settings.get"], input);

  return P.LanguageSettingsScope.match(scope, {
    App: () => true,
    Language: () => true,
    Host: () => false,
    Workspace: () => false,
  });
};

/** Uses current Main connections and live Daemon facts, never renderer snapshot caches. */
export const createMainLanguageApi = (options: MainLanguageOptions) => {
  const lifetime = new AbortController();
  const bindings = new Map<string, HostBinding>();
  const preparations = new Map<string, Promise<void>>();

  const retire = (hostKey: string) => {
    const binding = bindings.get(hostKey);
    bindings.delete(hostKey);
    binding?.controller.abort();
    binding?.host.access.dispose();
  };

  const connectionOf = (hostKey: string) =>
    HostDirectory.use((directory) => directory.connection(hostKey));

  const lookup = (hostKey: string): LanguageHost | null => {
    const binding = bindings.get(hostKey);

    if (binding === undefined || lifetime.signal.aborted) return null;

    try {
      const current = options.runtime.runSync(
        Effect.gen(function* () {
          const connection = yield* connectionOf(hostKey);
          const session = yield* connection.session;

          return { connection, session };
        })
      );

      const identity = options.identities.lookup(hostKey);

      if (
        current.connection === binding.connection &&
        current.session === binding.session &&
        identity !== null &&
        identity.connectionEpoch === binding.host.connectionEpoch &&
        identity.hostId === binding.host.hostId
      )
        return binding.host;
      retire(hostKey);

      return null;
    } catch {
      retire(hostKey);

      return null;
    }
  };

  const prepareCurrent = async (hostKey: string, callerSignal: AbortSignal) => {
    const signal = AbortSignal.any([callerSignal, lifetime.signal, AbortSignal.timeout(15000)]);

    const bound = await options.runtime.runPromise(
      Effect.gen(function* () {
        const connection = yield* connectionOf(hostKey);
        const session = yield* connection.session;

        const identity = options.identities.bind(hostKey, session);
        const authority = languageSessionAuthority(session);

        if (identity === null || authority === null || languageTransportFor(session) === null)
          return yield* Effect.fail(failure);

        const currentConnection = yield* connectionOf(hostKey);
        const currentSession = yield* currentConnection.session;

        if (
          currentConnection !== connection ||
          currentSession !== session ||
          options.identities.lookup(hostKey) !== identity
        )
          return yield* Effect.fail(failure);

        return { connection, session, identity };
      }),
      { signal }
    );

    const authority = languageSessionAuthority(bound.session);
    const identity = options.identities.lookup(hostKey);
    const transport = languageTransportFor(bound.session);

    if (authority === null || identity !== bound.identity || transport === null || signal.aborted)
      throw unavailable();
    const previous = bindings.get(hostKey);

    if (
      previous?.connection === bound.connection &&
      previous.session === bound.session &&
      lookup(hostKey) === previous.host
    )
      return;

    retire(hostKey);
    const facts = new LanguageRegistrations();
    const controller = new AbortController();
    const ready = options.runtime.runSync(Deferred.make<void>());

    const feed = options.runtime.runPromise(
      bound.session.client.subscribeHost({ afterSequence: null }).pipe(
        Stream.runForEach((item) =>
          Effect.gen(function* () {
            facts.receive(item);

            if (Predicate.isTagged(item, "Snapshot")) yield* Deferred.succeed(ready, undefined);
          })
        )
      ),
      { signal: AbortSignal.any([controller.signal, lifetime.signal]) }
    );

    void feed
      .finally(() => {
        if (bindings.get(hostKey)?.controller === controller) retire(hostKey);
        controller.abort();
      })
      .catch(() => undefined);

    const host: HostBinding["host"] = {
      hostId: authority.identity.hostId,
      access: new LanguageAccess(transport),
      connectionEpoch: bound.identity.connectionEpoch,
      authorizeWorkspace: (id) => facts.workspace(id),
      authorizeCheckout: (checkout) => facts.checkout(checkout),
    };

    bindings.set(hostKey, {
      connection: bound.connection,
      session: bound.session,
      host,
      controller,
    });

    try {
      await options.runtime.runPromise(Deferred.await(ready), {
        signal: AbortSignal.any([signal, controller.signal]),
      });
    } catch (error) {
      if (bindings.get(hostKey)?.host === host) retire(hostKey);
      throw error;
    }

    if (lookup(hostKey) !== host) throw unavailable();
  };

  const prepare = async (hostKey: string, signal: AbortSignal) => {
    const pending = preparations.get(hostKey);

    if (pending !== undefined) return pending;

    if (lookup(hostKey) !== null) return;
    const next = prepareCurrent(hostKey, signal);
    preparations.set(hostKey, next);

    try {
      await next;
    } finally {
      if (preparations.get(hostKey) === next) preparations.delete(hostKey);
    }
  };

  const bridge = createLanguageBridge({
    preferences: options.preferences,
    lookup,
    languageOf: (host, checkout, path) => {
      const detected = languageFor(path);
      const settings = options.preferences.effective(host.hostId, checkout.workspaceId, detected);

      return associatedLanguage(path, settings.settings.associations ?? [], detected);
    },
  });

  const api: LanguageApi = {
    request: async (method, input) => {
      try {
        const decoded = decodeLanguage(LanguageRequestInputs[method], input);

        if (!globalPreference(method, decoded)) await prepare(decoded.hostKey, lifetime.signal);

        return await bridge.request(method, input);
      } catch {
        return { ok: false, error: failure };
      }
    },
    subscribe: (kind, input, listener) => {
      const controller = new AbortController();
      let stop = () => {};

      void prepare(input.hostKey, AbortSignal.any([controller.signal, lifetime.signal]))
        .then(() => {
          if (!controller.signal.aborted) stop = bridge.subscribe(kind, input, listener);
        })
        .catch(() => {
          if (!controller.signal.aborted && !lifetime.signal.aborted) listener.end?.(failure);
        });

      return () => {
        controller.abort();
        stop();
      };
    },
  };

  return {
    api,
    dispose: () => {
      lifetime.abort();
      bridge.dispose();

      for (const hostKey of bindings.keys()) retire(hostKey);
    },
  };
};

// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- RPC/IPC boundaries accept untrusted bytes; matching schemas decode both directions before use.
import * as P from "@polaris/protocol";
import {
  LanguageAccess,
  decodeLanguage,
  languageFailure,
  languageMethods,
  languageFeeds,
} from "@polaris/client";
import { Schema } from "effect";
import type { LanguageApi, Result, IpcError } from "../../shared/api.ts";
import {
  LanguageRequestInputs,
  LanguageRequestOutputs,
  LanguageSubscriptionInputs,
  LanguageSubscriptionItems,
  type LanguageRequestMethod,
  type LanguageRequestInput,
  type LanguageRequestOutput,
} from "../../shared/languages.ts";
import { LanguagePreferences, scopeWorkspace, settingsScopeHost } from "./settings.ts";
import { LanguageMedia, type ImageNetwork } from "./media.ts";

export interface LanguageHost {
  readonly hostId: P.HostId;
  readonly access: LanguageAccess | null;
  /** Main's registered Workspace/checkout authority, independent of renderer IDs/paths. */
  readonly authorizeWorkspace: (workspaceId: P.WorkspaceId) => boolean;
  readonly authorizeCheckout: (checkout: P.LanguageCheckout) => boolean;
}

export interface LanguageBridgeOptions {
  readonly preferences: LanguagePreferences;
  readonly lookup: (hostKey: string) => LanguageHost | null;
  readonly network?: ImageNetwork;
  /** Main's syntax/association resolver; renderer Settings are never authoritative. */
  readonly languageOf?: (
    host: LanguageHost,
    checkout: P.LanguageCheckout,
    path: string,
    providerId: string
  ) => P.LanguageSyntaxId;
}

const routing = Schema.Struct({
  hostKey: Schema.String,
  workspaceId: Schema.optionalKey(P.WorkspaceId),
  checkout: Schema.optionalKey(P.LanguageCheckout),
  context: Schema.optionalKey(P.LanguageContextIdentity),
  fence: Schema.optionalKey(P.LanguageRequestFence),
  acceptance: Schema.optionalKey(P.LanguageTreeEditAcceptance),
  scope: Schema.optionalKey(Schema.Union([P.LanguageSettingsScope, P.LanguageTrustScope])),
  policy: Schema.optionalKey(P.LanguagePreviewPolicy),
});

const errorView = (error: unknown): IpcError => ({
  code: "LanguageError",
  message:
    error instanceof P.LanguageError
      ? `Language operation: ${error.reason}`
      : "Language operation failed",
});

const hostFor = (options: LanguageBridgeOptions, value: unknown): LanguageHost => {
  const input = decodeLanguage(routing, value);
  const host = options.lookup(input.hostKey);

  if (host === null) throw languageFailure("not-owner");
  const context = input.context ?? input.fence?.context ?? input.acceptance?.fence.context;
  const checkout = input.checkout ?? context?.checkout;

  const scopedHost =
    input.scope !== undefined && "hostId" in input.scope ? input.scope.hostId : undefined;

  if (
    (context !== undefined && context.hostId !== host.hostId) ||
    (scopedHost !== undefined && scopedHost !== host.hostId) ||
    (input.policy !== undefined && input.policy.hostId !== host.hostId)
  )
    throw languageFailure("not-owner");

  const workspaceId =
    input.workspaceId ??
    checkout?.workspaceId ??
    input.policy?.workspaceId ??
    (input.scope !== undefined && "workspaceId" in input.scope
      ? input.scope.workspaceId
      : undefined);

  if (
    (workspaceId !== undefined && !host.authorizeWorkspace(workspaceId)) ||
    (checkout !== undefined && !host.authorizeCheckout(checkout))
  )
    throw languageFailure("not-owner");

  return host;
};

const globalSettings = (
  preferences: LanguagePreferences,
  method: LanguageRequestMethod,
  value: unknown
): typeof P.LanguageSettingsRecord.Type | null => {
  if (method === "languages.settings.get") {
    const input = decodeLanguage(LanguageRequestInputs[method], value);

    return settingsScopeHost(input.scope) === null ? preferences.get(input.scope) : null;
  }

  if (method === "languages.settings.set") {
    const input = decodeLanguage(LanguageRequestInputs[method], value);

    return settingsScopeHost(input.scope) === null
      ? preferences.set(input.scope, input.expectedRevision, input.settings)
      : null;
  }

  return null;
};

/** Neutral UI adapter; Electron registration applies sender-origin checks separately. */
export const createLanguageBridge = (
  options: LanguageBridgeOptions
): LanguageApi & { dispose: () => void } => {
  const media = new LanguageMedia(options.preferences, options.network);
  const lifetime = new AbortController();
  const subscriptions = new Set<AbortController>();

  const local = async (
    method: LanguageRequestMethod,
    value: unknown,
    host: LanguageHost
  ): Promise<unknown> => {
    const p = options.preferences;

    switch (method) {
      case "languages.settings.get": {
        const input = decodeLanguage(LanguageRequestInputs[method], value);

        return p.get(input.scope);
      }

      case "languages.settings.set": {
        const input = decodeLanguage(LanguageRequestInputs[method], value);

        return p.set(input.scope, input.expectedRevision, input.settings);
      }

      case "languages.preview.policy.get": {
        const input = decodeLanguage(LanguageRequestInputs[method], value);

        return p.policy(host.hostId, input.workspaceId);
      }

      case "languages.preview.policy.set": {
        const input = decodeLanguage(LanguageRequestInputs[method], value);

        return p.setPolicy(input.policy);
      }

      case "languages.preview.external": {
        const input = decodeLanguage(LanguageRequestInputs[method], value);

        return media.external(
          host.hostId,
          input.workspaceId,
          input.url,
          input.maxBytes,
          lifetime.signal
        );
      }

      case "languages.preview.media": {
        const input = decodeLanguage(LanguageRequestInputs[method], value);

        if (host.access === null) throw languageFailure("not-connected");

        return media.relative(host.access, input, lifetime.signal);
      }

      case "languages.context.acquire": {
        const input = decodeLanguage(LanguageRequestInputs[method], value);

        if (host.access === null || options.languageOf === undefined)
          throw languageFailure("not-ready");
        const language = options.languageOf(host, input.checkout, input.path, input.providerId);

        return host.access.request(
          method,
          { ...input, settings: p.effective(host.hostId, input.checkout.workspaceId, language) },
          lifetime.signal
        );
      }

      case "languages.discover": {
        const input = decodeLanguage(LanguageRequestInputs[method], value);

        if (host.access === null || options.languageOf === undefined)
          throw languageFailure("not-ready");

        const language = options.languageOf(
          host,
          input.checkout,
          input.path,
          input.documentLanguageId
        );

        return host.access.request(
          method,
          { ...input, settings: p.effective(host.hostId, input.checkout.workspaceId, language) },
          lifetime.signal
        );
      }

      case "languages.context.configure": {
        const input = decodeLanguage(LanguageRequestInputs[method], value);

        if (host.access === null || options.languageOf === undefined)
          throw languageFailure("not-ready");

        const language = options.languageOf(
          host,
          input.context.checkout,
          input.context.projectRoot,
          input.context.providerId
        );

        return host.access.request(
          method,
          {
            ...input,
            settings: p.effective(host.hostId, input.context.checkout.workspaceId, language),
          },
          lifetime.signal
        );
      }

      default: {
        if (host.access === null) throw languageFailure("unsupported-capability");

        if (!Object.hasOwn(languageMethods, method))
          throw languageFailure("unsupported-capability");

        // SAFETY: input was decoded with this method's IPC schema; HostKey is removed by RPC decoding.
        return host.access.request(
          method,
          decodeLanguage(languageMethods[method].payloadSchema, value),
          lifetime.signal
        );
      }
    }
  };

  const request = async <M extends LanguageRequestMethod>(
    method: M,
    value: LanguageRequestInput<M>
  ): Promise<Result<LanguageRequestOutput<M>>> => {
    try {
      if (lifetime.signal.aborted) throw languageFailure("cancelled");
      const input = decodeLanguage(LanguageRequestInputs[method], value);
      const global = globalSettings(options.preferences, method, input);

      if (global !== null)
        return { ok: true, value: decodeLanguage(LanguageRequestOutputs[method], global) };
      const host = hostFor(options, input);
      const result = await local(method, input, host);

      if (lifetime.signal.aborted || options.lookup(input.hostKey) !== host)
        throw languageFailure("not-connected");

      // SAFETY: matching IPC output schema enforces method-specific structured clone data.
      return {
        ok: true,
        value: decodeLanguage(LanguageRequestOutputs[method], result) as LanguageRequestOutput<M>,
      };
    } catch (error) {
      return { ok: false, error: errorView(error) };
    }
  };

  const subscribe: LanguageApi["subscribe"] = (kind, value, listener) => {
    const controller = new AbortController();
    subscriptions.add(controller);
    void (async () => {
      try {
        const input = decodeLanguage(LanguageSubscriptionInputs[kind], value);
        const host = hostFor(options, input);

        if (host.access === null || !Object.hasOwn(languageFeeds, kind))
          throw languageFailure("unsupported-capability");
        const signal = AbortSignal.any([lifetime.signal, controller.signal]);

        // SAFETY: matching feed IPC schema has already decoded the payload.
        for await (const item of host.access.watch(kind, input, signal)) {
          if (signal.aborted) return;

          if (options.lookup(input.hostKey) !== host) throw languageFailure("not-connected");
          // SAFETY: kind selects the corresponding output schema and listener item type.
          listener.items([decodeLanguage(LanguageSubscriptionItems[kind], item)]);
        }

        if (!controller.signal.aborted) listener.end?.(null);
      } catch (error) {
        if (!controller.signal.aborted) listener.end?.(errorView(error));
      } finally {
        subscriptions.delete(controller);
      }
    })();

    return () => {
      controller.abort();
      subscriptions.delete(controller);
    };
  };

  return {
    request,
    subscribe,
    dispose: () => {
      lifetime.abort();

      for (const controller of subscriptions) controller.abort();
      subscriptions.clear();
    },
  };
};

export { LanguagePreferences, scopeWorkspace, settingsScopeHost, LanguageMedia };

/**
 * Folds context events and install facts into the status and log stores. The coordinator calls
 * `contextObserved` for every event of every context it watches; the pill opens `watchHostTools`
 * only while its file is setting up.
 */
import * as P from "@polaris/protocol";
import { Match, Option, Predicate, Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { appendFeed, appendStderr, type LogScope } from "./log.ts";
import { catalogArrived, hostStateArrived, runtimeArrived, type Runtime } from "./store.ts";
import { languageIpcError } from "../../../../shared/languageError.ts";

export const scopeOf = (hostKey: string, context: P.LanguageContextIdentity): LogScope => ({
  hostKey,
  checkout: context.checkout,
  providerId: context.providerId,
});

const runtimeObserved = (hostKey: string, context: P.LanguageContextIdentity, runtime: Runtime) => {
  runtimeArrived(hostKey, context, runtime);

  if (Predicate.isTagged(runtime, "Stopped") && runtime.failure !== undefined)
    appendStderr(scopeOf(hostKey, context), runtime.failure.stderr);
};

export const contextObserved = (hostKey: string, event: P.LanguageContextEvent) =>
  Match.value(event).pipe(
    Match.tag("Snapshot", "RuntimeChanged", (value) =>
      runtimeObserved(hostKey, value.context, value.runtime)
    ),
    Match.tag("Replaced", (value) => runtimeObserved(hostKey, value.replacement, value.runtime)),
    Match.orElse(() => undefined)
  );

/** A restart answers with fresh snapshots before the watch does; fold them the same way. */
export const snapshotsObserved = (hostKey: string, snapshots: readonly unknown[]) => {
  for (const raw of snapshots) {
    const snapshot = Schema.decodeUnknownOption(P.LanguageContextSnapshot)(raw);

    if (Option.isSome(snapshot))
      runtimeObserved(hostKey, snapshot.value.context, snapshot.value.runtime);
  }
};

/** Catalog dependencies needed by this file's integration, without unrelated language tools. */
export const statusToolIds = (catalog: P.LanguageCatalog, language: string) => {
  const offered = new Map(catalog.tools.map((tool) => [tool.id, tool]));

  const integrations = catalog.integrations.filter(
    (item) =>
      item.languageIds.includes(language) ||
      item.providers.some((provider) => provider.id === language)
  );

  const ids = new Set(
    integrations.flatMap((item) => [
      ...item.providers.map((provider) => provider.tool),
      ...item.companions,
      ...(item.formatter.source === "managed" ? [item.formatter.tool] : []),
    ])
  );

  // Bundled TypeScript is selected alongside the managed server (ADR 0029).
  if (ids.has("typescript-language-server")) ids.add("typescript");

  for (const id of ids)
    for (const requirement of offered.get(id)?.requirements ?? [])
      if (offered.has(requirement.id)) ids.add(requirement.id);

  return [...ids].filter((id) => offered.has(id));
};

/** Explicit recheck publishes fresh Prerequisite facts to every open Host-state watch. */
export const refreshHostTools = async (api: LanguageApi, hostKey: string, language: string) => {
  const catalog = await api.request("languages.catalog", { hostKey });

  if (!catalog.ok) throw languageIpcError(catalog.error);
  const decoded = Schema.decodeUnknownSync(P.LanguageCatalog)(catalog.value);
  const toolIds = statusToolIds(decoded, language);
  catalogArrived(hostKey, decoded);

  if (!toolIds.length) return;
  const state = await api.request("languages.host.state", { hostKey, toolIds, refresh: true });

  if (!state.ok) throw languageIpcError(state.error);
  hostStateArrived(hostKey, Schema.decodeUnknownSync(P.LanguageHostState)(state.value));
};

/** The file's installation facts, from the sole Host installer feed, until disposed. */
export const watchHostTools = (api: LanguageApi, hostKey: string, language: string) => {
  let active = true;
  let unwatch: (() => void) | null = null;

  void (async () => {
    const catalog = await api.request("languages.catalog", { hostKey });

    if (!active || !catalog.ok) return;
    const decoded = Schema.decodeUnknownSync(P.LanguageCatalog)(catalog.value);
    catalogArrived(hostKey, decoded);
    const toolIds = statusToolIds(decoded, language);

    if (!toolIds.length) return;
    unwatch = api.subscribe(
      "languages.host.state.watch",
      { hostKey, toolIds, refresh: false },
      {
        items: (items) => {
          for (const item of items)
            if (active)
              hostStateArrived(hostKey, Schema.decodeUnknownSync(P.LanguageHostState)(item));
        },
        end: () => undefined,
      }
    );
  })().catch(() => undefined);

  return () => {
    active = false;
    unwatch?.();
  };
};

/**
 * The Daemon's live log for one server generation (`languages.log.watch`): its backlog, then
 * each line. The feed ends with the generation; the caller subscribes again with the replacement.
 */
export const watchServerLog = (
  api: LanguageApi,
  hostKey: string,
  context: P.LanguageContextIdentity
) => {
  const scope = scopeOf(hostKey, context);
  const cursor = { contextId: context.contextId, generation: context.generation };

  return api.subscribe(
    "languages.log.watch",
    { hostKey, context },
    {
      items: (items) => {
        for (const item of items) {
          const event = Schema.decodeUnknownSync(P.LanguageServerLogEvent)(item);

          Match.value(event).pipe(
            Match.tag("Snapshot", (value) => appendFeed(scope, cursor, value.lines)),
            Match.tag("Line", (value) => appendFeed(scope, cursor, [value.line])),
            Match.exhaustive
          );
        }
      },
      end: () => undefined,
    }
  );
};

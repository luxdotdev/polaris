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

/** The Host's installation state for every catalog tool, from its feed, until disposed. */
export const watchHostTools = (api: LanguageApi, hostKey: string) => {
  let active = true;
  let unwatch: (() => void) | null = null;

  void (async () => {
    const catalog = await api.request("languages.catalog", { hostKey });

    if (!active || !catalog.ok) return;
    catalogArrived(hostKey, Schema.decodeUnknownSync(P.LanguageCatalog)(catalog.value));

    // An empty list is the whole catalog; the feed opens with a full snapshot.
    unwatch = api.subscribe(
      "languages.host.state.watch",
      { hostKey, toolIds: [], refresh: false },
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

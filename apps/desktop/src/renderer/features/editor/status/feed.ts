/**
 * Folds context events and install facts into the status and log stores. The coordinator calls
 * `contextObserved` for every event of every context it watches; the pill opens `watchHostTools`
 * only while its file is setting up.
 */
import * as P from "@polaris/protocol";
import { Match, Option, Predicate, Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { LanguageSubscriptionItems } from "../../../../shared/languages.ts";
import { appendFeed, appendStderr, type LogScope } from "./log.ts";
import {
  availabilityArrived,
  catalogArrived,
  progressArrived,
  runtimeArrived,
  type Runtime,
} from "./store.ts";

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

/** Availability and install progress for every catalog tool on a Host, until disposed. */
export const watchHostTools = (api: LanguageApi, hostKey: string) => {
  let active = true;
  const jobs = new Map<string, () => void>();
  let unwatch: (() => void) | null = null;

  const watchJob = (fact: P.LanguageAvailability) => {
    const installing = Predicate.isTagged(fact.installation, "Installing")
      ? fact.installation.jobId
      : null;

    for (const [jobId, dispose] of jobs)
      if (jobId !== installing && jobId.startsWith(`${fact.toolId}:`)) {
        dispose();
        jobs.delete(jobId);
      }

    if (installing === null || jobs.has(`${fact.toolId}:${installing}`)) return;
    jobs.set(
      `${fact.toolId}:${installing}`,
      api.subscribe(
        "languages.install.watch",
        { hostKey, jobId: installing },
        {
          items: (items) => {
            if (!active) return;

            for (const item of items)
              progressArrived(hostKey, Schema.decodeUnknownSync(P.LanguageInstallProgress)(item));
          },
          end: () => undefined,
        }
      )
    );
  };

  const received = (facts: readonly P.LanguageAvailability[]) => {
    if (!active) return;
    availabilityArrived(hostKey, facts);
    facts.forEach(watchJob);
  };

  void (async () => {
    const catalog = await api.request("languages.catalog", { hostKey });

    if (!active || !catalog.ok) return;

    const known = Schema.decodeUnknownSync(P.LanguageCatalog)(catalog.value);
    catalogArrived(hostKey, known);

    const catalogIds = known.tools.map((tool) => tool.id).slice(0, 512);

    // One tool the Host can't describe fails a whole batch, so ask per tool and keep the answers.
    const answers = await Promise.all(
      catalogIds.map((toolId) =>
        api.request("languages.availability", {
          hostKey,
          toolIds: [toolId],
          checkout: null,
          refresh: false,
          phase: "install",
        })
      )
    );

    const facts = answers.flatMap((answer) =>
      answer.ok
        ? Schema.decodeUnknownSync(LanguageSubscriptionItems["languages.availability.watch"])(
            answer.value
          )
        : []
    );

    const toolIds = facts.map((fact) => fact.toolId);
    received(facts);

    if (!active) return;
    unwatch = api.subscribe(
      "languages.availability.watch",
      { hostKey, toolIds, checkout: null },
      {
        items: (items) => {
          for (const item of items)
            received(
              Schema.decodeUnknownSync(LanguageSubscriptionItems["languages.availability.watch"])(
                item
              )
            );
        },
        end: () => undefined,
      }
    );
  })().catch(() => undefined);

  return () => {
    active = false;
    unwatch?.();
    jobs.forEach((dispose) => dispose());
    jobs.clear();
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

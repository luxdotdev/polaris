import * as P from "@polaris/protocol";
import { Match, Predicate, Schema } from "effect";
import type {
  LanguageSettingsAdapter,
  LanguageSettingsAction,
  LanguageSettingsSnapshot,
  LanguageSettingsResult,
} from "./contracts.ts";
import type { LanguageIntegrationOptions } from "./integrationContracts.ts";
import { refreshConfirmedLanguageSettings } from "./refresh.ts";
import { watchLanguageFacts } from "./watch.ts";
import { loadHostFacts } from "./hostFacts.ts";
import { readPreferences, sameScope } from "./preferences.ts";
import { toolAction, trustFacts, trustMatchesCheckout } from "./toolState.ts";

const unavailable = (): LanguageSettingsResult<never> => ({
  ok: false,
  message: "Language API unavailable. Connect or upgrade the host, then refresh facts.",
});

const cancelled = (): LanguageSettingsResult<never> => ({
  ok: false,
  message: "Completion is unknown. Refresh facts before trying another change.",
});

const catalogChoices = (
  catalogs: ReadonlyArray<P.LanguageCatalog>,
  language: P.LanguageSyntaxId
) => {
  const integrations = catalogs
    .flatMap((c) => c.integrations)
    .filter((i) => i.languageIds.includes(language));

  const providers = new Map(
    integrations.flatMap((i) => i.providers).map((p) => [p.id, { id: p.id, name: p.id }])
  );

  const formatters = new Map(
    integrations.flatMap((i) => {
      const provider = i.providers.find((p) => p.tool === i.formatter.tool);

      return provider && i.formatter.mode === "lsp"
        ? [
            [
              provider.id,
              {
                key: provider.id,
                name: provider.id,
                selection: P.LanguageFormatterSelection.cases.Provider.make({
                  providerId: provider.id,
                }),
              },
            ] as const,
          ]
        : [];
    })
  );

  return { providers: [...providers.values()], formatters: [...formatters.values()] };
};

const actionAllowed = (snapshot: LanguageSettingsSnapshot, action: LanguageSettingsAction) => {
  if (action.kind === "refresh") return true;
  const host = snapshot.hosts.find((h) => h.key === action.hostKey);

  if (!host) return false;

  if (action.kind === "recover-host") return action.recovery === host.recovery;

  if (host.connection !== "Connected" || host.capability !== "available") return false;

  if (action.kind === "trust") {
    const facts = trustFacts(host);

    return (
      host.canSetTrust === true &&
      trustMatchesCheckout(host) &&
      facts !== null &&
      Schema.toEquivalence(P.LanguageTrust)(action.trust, facts.trust)
    );
  }

  return host.tools.some((tool) => {
    if (action.kind === "logs")
      return (
        tool.actions.logs !== undefined &&
        Schema.toEquivalence(P.LanguageContextIdentity)(tool.actions.logs, action.context)
      );

    if (action.kind === "install" && action.intent === "rollback")
      return (
        action.toolId === tool.availability.toolId &&
        tool.actions.rollback === action.version &&
        Predicate.isTagged(tool.availability.preflight, "Eligible")
      );
    const primary = toolAction(host, tool)?.action;

    return primary !== undefined && JSON.stringify(primary) === JSON.stringify(action);
  });
};

export const createLanguageSettingsAdapter = (
  options: LanguageIntegrationOptions
): LanguageSettingsAdapter => {
  let current: LanguageSettingsSnapshot | null = null;
  let epoch = 0;
  let currentToken: object | null = null;
  const watches = new Set<() => void>();

  const invalidate = () => {
    current = null;
    currentToken = null;
    watches.forEach((stop) => stop());
    watches.clear();

    return ++epoch;
  };

  const hostKeyFor = (scope: P.LanguageSettingsScope) => {
    const hostId = "hostId" in scope ? scope.hostId : null;

    return (
      options.hosts.find((h) => h.status.host?.hostId === hostId)?.key ??
      options.selected?.hostKey ??
      options.hosts[0]?.key ??
      "client-local"
    );
  };

  return {
    watch: (snapshot, receive) => {
      if (!current || !currentToken || snapshot.observation !== currentToken) return () => {};

      try {
        const record = Schema.decodeUnknownSync(P.LanguageSettingsRecord)(snapshot.record);

        if (!Schema.toEquivalence(P.LanguageSettingsRecord)(current.record, record))
          return () => {};
      } catch {
        return () => {};
      }

      const turn = epoch;

      const stop = watchLanguageFacts(options, current, (hosts) => {
        if (turn !== epoch || current === null) return;

        if (hosts === null) {
          invalidate();
          receive(null);

          return;
        }

        current = { ...current, hosts };
        receive(current);
      });

      watches.add(stop);

      return () => {
        stop();
        watches.delete(stop);
      };
    },
    load: async (scope, signal) => {
      const turn = invalidate();

      if (!options.api) return unavailable();

      try {
        const preferences = await readPreferences(
          options.api,
          hostKeyFor,
          scope,
          effectiveScopeFor(options, scope),
          options.language,
          signal
        );

        const hostId = "hostId" in scope ? scope.hostId : null;

        const selected = options.hosts.filter(
          (h) => hostId === null || h.status.host?.hostId === hostId
        );

        const facts = await Promise.all(
          selected.map((host) => loadHostFacts(options, host, preferences.effective, signal))
        );

        if (signal.aborted || turn !== epoch) return cancelled();

        const observation = {};

        const snapshot = {
          observation,
          ...preferences,
          ...catalogChoices(
            facts.flatMap((f) => (f.catalog ? [f.catalog] : [])),
            options.language
          ),
          hosts: facts.flatMap((f) => (f.view ? [f.view] : [])),
        };

        current = snapshot;
        currentToken = observation;

        return { ok: true, value: snapshot };
      } catch {
        return signal.aborted
          ? cancelled()
          : { ok: false, message: "Couldn't load language settings. Refresh facts to retry." };
      }
    },
    save: async (record, signal) => {
      const previous = current;
      const turn = invalidate();

      if (!options.api) return unavailable();

      if (
        !previous ||
        !sameScope(previous.record.scope, record.scope) ||
        previous.record.revision !== record.revision ||
        signal.aborted
      )
        return cancelled();

      try {
        const input = Schema.decodeUnknownSync(P.LanguageSettingsRecord)(record);

        const result = await options.api.request("languages.settings.set", {
          hostKey: hostKeyFor(input.scope),
          scope: input.scope,
          expectedRevision: input.revision,
          settings: input.settings,
        });

        if (signal.aborted || turn !== epoch) return cancelled();

        if (!result.ok)
          return {
            ok: false,
            message: "Couldn't save language settings. Refresh facts to check the revision.",
          };
        const confirmed = Schema.decodeUnknownSync(P.LanguageSettingsRecord)(result.value);

        if (
          !sameScope(confirmed.scope, input.scope) ||
          confirmed.revision !== input.revision + 1 ||
          !Schema.toEquivalence(P.LanguageSettingsPatch)(confirmed.settings, input.settings)
        )
          return cancelled();

        refreshConfirmedLanguageSettings(options, input.scope);

        return { ok: true, value: undefined };
      } catch {
        return cancelled();
      }
    },
    act: async (action, signal) => {
      const previous = current;
      const turn = invalidate();

      if (!previous || !actionAllowed(previous, action) || signal.aborted) return cancelled();

      try {
        if (action.kind === "recover-host") return await options.recover(action);

        if (!options.api) return unavailable();

        if (action.kind === "logs")
          return (await options.logs?.(action.hostKey, action.context)) ?? unavailable();
        const result = await runAction(options.api, action);

        if (signal.aborted || turn !== epoch) return cancelled();

        if (result.ok && action.kind === "trust")
          refreshConfirmedLanguageSettings(
            options,
            P.LanguageSettingsScope.cases.Workspace.make({
              hostId: action.trust.scope.hostId,
              workspaceId: action.trust.scope.workspaceId,
              language: null,
            })
          );

        return result.ok
          ? { ok: true, value: undefined }
          : { ok: false, message: "Host action failed. Refresh facts to check its outcome." };
      } catch {
        return signal.aborted
          ? cancelled()
          : { ok: false, message: "Host action failed. Refresh facts to check its outcome." };
      }
    },
  };
};

const runAction = async (
  api: NonNullable<LanguageIntegrationOptions["api"]>,
  action: LanguageSettingsAction
) => {
  switch (action.kind) {
    case "install":
      return api.request("languages.install", {
        hostKey: action.hostKey,
        toolId: action.toolId,
        version: action.version,
        intent: action.intent,
      });
    case "retry":
      return api.request("languages.install", {
        hostKey: action.hostKey,
        toolId: action.toolId,
        version: action.version,
        intent: "manual",
      });
    case "cancel-install":
      return api.request("languages.install.cancel", {
        hostKey: action.hostKey,
        jobId: action.jobId,
      });
    case "restart":
      return api.request("languages.context.restart", {
        hostKey: action.hostKey,
        context: action.context,
      });
    case "trust": {
      const result = await api.request("languages.trust.set", {
        hostKey: action.hostKey,
        scope: action.trust.scope,
        trusted: action.trusted,
        expectedRevision: action.trust.revision,
      });

      if (result.ok) {
        const confirmed = Schema.decodeUnknownSync(P.LanguageTrust)(result.value);

        const expected = P.LanguageTrust.make({
          scope: action.trust.scope,
          revision: action.trust.revision + 1,
          trusted: action.trusted,
        });

        if (!Schema.toEquivalence(P.LanguageTrust)(confirmed, expected))
          throw new Error("Unconfirmed trust mutation");
      }

      return result;
    }

    default:
      return { ok: true, value: undefined };
  }
};

const effectiveScopeFor = (
  options: LanguageIntegrationOptions,
  edited: P.LanguageSettingsScope
): P.LanguageSettingsScope => {
  const host = options.hosts.find((h) => h.key === options.selected?.hostKey);

  if (options.selected && host?.status.host)
    return P.LanguageSettingsScope.cases.Workspace.make({
      hostId: host.status.host.hostId,
      workspaceId: options.selected.checkout.workspaceId,
      language: options.language,
    });

  return Match.value(edited).pipe(
    Match.tag("Host", () => edited),
    Match.tag("Workspace", (scope) =>
      P.LanguageSettingsScope.cases.Workspace.make({ ...scope, language: options.language })
    ),
    Match.orElse(() => P.LanguageSettingsScope.cases.Language.make({ language: options.language }))
  );
};

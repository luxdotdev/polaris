import * as P from "@polaris/protocol";
import { Match, Schema } from "effect";
import type { HostView } from "../../../../shared/api.ts";
import type { LanguageHostView, LanguageSettingsSnapshot } from "./contracts.ts";
import type { LanguageIntegrationOptions } from "./integrationContracts.ts";

export const connectionLabel = (host: HostView) =>
  Match.value(host.status.state).pipe(
    Match.when("connected", () => "Connected" as const),
    Match.when("reconnecting", () => "Reconnecting" as const),
    Match.when("needs-attention", () => "Needs Attention" as const),
    Match.orElse(() => "Offline" as const)
  );

export const loadHostFacts = async (
  options: LanguageIntegrationOptions,
  host: HostView,
  effective: LanguageSettingsSnapshot["effective"],
  signal: AbortSignal
): Promise<{ view: LanguageHostView | null; catalog: P.LanguageCatalog | null }> => {
  const identity = host.status.host;

  if (!identity) return { view: null, catalog: null };
  const capable = options.api !== undefined && host.status.capabilities.includes("languages");

  const view: LanguageHostView = {
    key: host.key,
    id: identity.hostId,
    name: host.label,
    connection: connectionLabel(host),
    capability: capable ? "available" : "unsupported",
    detail: capable ? "Current host facts" : "Language API unavailable",
    recovery: connectionLabel(host) === "Offline" ? "reconnect" : capable ? null : "upgrade",
    tools: [],
    discovery: null,
    canSetTrust: host.status.capabilities.includes("languages.trust"),
  };

  if (!capable || host.status.state !== "connected" || !options.api) return { view, catalog: null };

  try {
    signal.throwIfAborted();
    const response = await options.api.request("languages.catalog", { hostKey: host.key });
    signal.throwIfAborted();

    if (!response.ok)
      return {
        view: { ...view, detail: "Couldn't read catalog. Refresh facts to retry." },
        catalog: null,
      };
    const catalog = Schema.decodeUnknownSync(P.LanguageCatalog)(response.value);

    const integrations = catalog.integrations.filter((i) =>
      i.languageIds.includes(options.language)
    );

    const ids = new Set(
      integrations.flatMap((i) => [
        ...i.providers.map((p) => p.tool),
        ...i.companions,
        i.formatter.tool,
      ])
    );

    const checkout = options.selected?.hostKey === host.key ? options.selected.checkout : null;

    const available = await options.api.request("languages.availability", {
      hostKey: host.key,
      toolIds: [...ids],
      checkout,
      refresh: true,
      phase: "feature",
    });

    signal.throwIfAborted();

    if (!available.ok)
      return {
        view: { ...view, detail: "Couldn't read prerequisites. Refresh facts to retry." },
        catalog,
      };

    const facts = Schema.decodeUnknownSync(P.GetLanguageAvailability.successSchema)(
      available.value
    );

    if (facts.some((f) => f.hostId !== identity.hostId || !ids.has(f.toolId)))
      throw new Error("Foreign facts");

    const discovery = checkout
      ? await readDiscovery(options, host, checkout, effective, signal)
      : null;

    return {
      catalog,
      view: {
        ...view,
        discovery,
        tools: facts.map((availability) => ({
          name: catalog.tools.find((t) => t.id === availability.toolId)?.id ?? availability.toolId,
          availability,
          runtime: null,
          progress: null,
          actions: host.status.capabilities.includes("languages.install")
            ? (options.permissions?.(host.key, availability) ?? {})
            : {},
        })),
      },
    };
  } catch {
    signal.throwIfAborted();

    return {
      catalog: null,
      view: {
        ...view,
        detail: "Couldn't validate host facts. Refresh facts to retry.",
        canSetTrust: false,
      },
    };
  }
};

const readDiscovery = async (
  options: LanguageIntegrationOptions,
  host: HostView,
  checkout: P.LanguageCheckout,
  effective: LanguageSettingsSnapshot["effective"],
  signal: AbortSignal
): Promise<LanguageHostView["discovery"]> => {
  if (!options.api) return null;

  const result = await options.api.request("languages.discover", {
    hostKey: host.key,
    checkout,
    path: checkout.path,
    documentLanguageId: options.language,
    settings: effective,
  });

  signal.throwIfAborted();

  if (!result.ok) return null;

  const found = Schema.decodeUnknownSync(P.LanguageDiscovery)(result.value);

  if (
    !Schema.toEquivalence(P.LanguageCheckout)(found.checkout, checkout) ||
    found.trust.scope.hostId !== host.status.host?.hostId ||
    found.trust.scope.workspaceId !== checkout.workspaceId
  )
    throw new Error("Foreign discovery");

  return found;
};

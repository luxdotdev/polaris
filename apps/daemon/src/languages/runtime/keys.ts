import type { Entry } from "./types.ts";
import type { LanguageJsonObject } from "@polaris/protocol";
import type { LanguageContextIdentity } from "@polaris/protocol";
import type { DiscoveryFacts } from "../discovery/index.ts";
import { checkoutKey } from "../trust/index.ts";

export const sameIdentity = (a: LanguageContextIdentity, b: LanguageContextIdentity) =>
  JSON.stringify(a) === JSON.stringify(b);

export const contextKey = (clientId: string, facts: DiscoveryFacts) =>
  JSON.stringify([
    clientId,
    checkoutKey(facts.checkout),
    facts.checkout.path,
    facts.projectRoot,
    facts.providerId,
    facts.configurationFingerprint,
  ]);

export function initialization(entry: Entry): typeof LanguageJsonObject.Type {
  const settings = entry.facts.effectiveSettings.settings;

  return (
    settings.customServers?.find(({ id }) => id === entry.facts.providerId)
      ?.initializationOptions ?? {}
  );
}

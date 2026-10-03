import * as P from "@polaris/protocol";
import { Match, Schema } from "effect";
import type {
  LanguageIntegrationOptions,
  RegisteredLanguageCheckout,
} from "./integrationContracts.ts";

const affected = (
  options: LanguageIntegrationOptions,
  checkout: RegisteredLanguageCheckout,
  scope: P.LanguageSettingsScope
) => {
  const hostId = options.hosts.find((h) => h.key === checkout.hostKey)?.status.host?.hostId;

  if (!hostId) return false;

  return Match.value(scope).pipe(
    Match.tag("App", () => true),
    Match.tag("Language", () => true),
    Match.tag("Host", (s) => hostId === s.hostId),
    Match.tag(
      "Workspace",
      (s) => hostId === s.hostId && checkout.checkout.workspaceId === s.workspaceId
    ),
    Match.exhaustive
  );
};

/** Confirmed scope mutations refresh only registered matching Editor lifetimes. */
export const refreshConfirmedLanguageSettings = (
  options: LanguageIntegrationOptions,
  scope: P.LanguageSettingsScope
) => {
  const valid = Schema.decodeUnknownSync(P.LanguageSettingsScope)(scope);
  const targets = options.checkouts ?? (options.selected ? [options.selected] : []);
  const seen = new Set<string>();

  for (const checkout of targets) {
    if (!affected(options, checkout, valid)) continue;
    const key = `${checkout.hostKey}\u0000${checkout.checkout.workspaceId}`;

    if (seen.has(key)) continue;
    seen.add(key);
    options.refreshLanguageSettings?.(checkout.hostKey, checkout.checkout.workspaceId);
  }
};

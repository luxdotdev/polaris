import { webProviders, webServerSettings } from "../web/index.ts";
import { pythonServerSettings } from "../python/launch.ts";
import type { LanguageJsonObject } from "@polaris/protocol";
import type { Entry } from "./types.ts";

export function serverSettings(entry: Entry): typeof LanguageJsonObject.Type {
  const settings = entry.facts.effectiveSettings.settings;

  if (entry.facts.managedPython && entry.facts.providerId === "basedpyright")
    return pythonServerSettings(entry.facts);

  if (entry.facts.managedWeb && entry.facts.providerId in webProviders)
    return {
      ...webServerSettings(entry.facts),
      ...settings.serverSettings?.[entry.facts.providerId],
    };

  return (
    settings.customServers?.find(({ id }) => id === entry.facts.providerId)?.settings ??
    settings.serverSettings?.[entry.facts.providerId] ??
    {}
  );
}

import * as P from "@polaris/protocol";
import { Schema } from "effect";

/** Renderer answers only this acquired provider's settings and checkout-contained scopes. */
export const configurationItems = (
  context: P.LanguageContextIdentity,
  settings: typeof P.LanguageEffectiveSettings.Type,
  items: readonly (typeof P.LanguageConfigurationItem.Type)[]
): (typeof P.LanguageJson.Type)[] => {
  const configured =
    settings.settings.customServers?.find((item) => item.id === context.providerId)?.settings ??
    settings.settings.serverSettings?.[context.providerId] ??
    {};

  return items.map((item) => {
    if (item.scopeUri !== undefined && !containedScope(item.scopeUri, context.checkout.path))
      return null;
    let value: typeof P.LanguageJson.Type = configured;

    for (const segment of item.section?.split(".") ?? []) {
      if (!Schema.is(P.LanguageJsonObject)(value) || !Object.hasOwn(value, segment)) return null;
      value = value[segment] ?? null;
    }

    return value;
  });
};

const containedScope = (uri: string, root: string): boolean => {
  try {
    const url = new URL(uri);
    const path = decodeURIComponent(url.pathname);

    return (
      url.protocol === "file:" &&
      url.hostname === "" &&
      !path.split("/").includes("..") &&
      (path === root || path.startsWith(`${root.replace(/\/+$/, "")}/`))
    );
  } catch {
    return false;
  }
};

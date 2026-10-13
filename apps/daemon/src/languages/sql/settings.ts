import type { LanguageJsonObject } from "@polaris/protocol";
import type { DiscoveryFacts } from "../discovery/index.ts";
import type { Launch } from "../runtime/process.ts";

/** Managed companions and SQL configuration stay fixed to Host-controlled launch observations. */
export function managedSqlShellSettings(
  facts: Pick<DiscoveryFacts, "managedSqlShell" | "providerId">,
  launch: Pick<Launch, "initializationOptions">
): typeof LanguageJsonObject.Type | null {
  if (!facts.managedSqlShell) return null;

  if (facts.providerId === "bash-language-server")
    return { bashIde: launch.initializationOptions ?? {} };

  return facts.providerId === "sqllens-language-server" ? {} : null;
}

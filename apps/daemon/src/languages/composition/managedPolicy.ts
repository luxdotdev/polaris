import { webProviders } from "../web/index.ts";
import type { DiscoveryFacts } from "../discovery/index.ts";
import { configuredExecutable } from "./configuredLaunch.ts";

/** The bundled selection runs private TypeScript with Workspace plugin loading disabled. */
export const bundledTypeScript = (facts: DiscoveryFacts) =>
  facts.bundledTypeScript === true &&
  facts.providerId === "typescript-language-server" &&
  configuredExecutable(facts) === undefined;

/** Managed Python reads configuration without running Workspace tooling. */
export const managedWithoutTrust = (facts: DiscoveryFacts) =>
  bundledTypeScript(facts) ||
  (facts.managedSqlShell === true &&
    ["bash-language-server", "sqllens-language-server"].includes(facts.providerId) &&
    configuredExecutable(facts) === undefined) ||
  (facts.managedWeb === true &&
    facts.providerId in webProviders &&
    !(
      facts.workspaceTrusted &&
      ["svelte-language-server", "prisma-language-server"].includes(facts.providerId)
    ) &&
    configuredExecutable(facts) === undefined) ||
  (facts.managedPython === true &&
    ["basedpyright", "ruff"].includes(facts.providerId) &&
    configuredExecutable(facts) === undefined);

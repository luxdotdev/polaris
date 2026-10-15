import { webProviders } from "../web/index.ts";
import type { DiscoveryFacts } from "../discovery/index.ts";
import { configuredExecutable } from "./configuredLaunch.ts";

/** The bundled selection runs private TypeScript with Workspace plugin loading disabled. */
export const bundledTypeScript = (facts: DiscoveryFacts) =>
  facts.bundledTypeScript === true &&
  facts.providerId === "typescript-language-server" &&
  configuredExecutable(facts) === undefined;

/** A trusted project's TypeScript 6 or older, or its tsserver plugins, need tsserver (ADR 0051). */
export const projectTsserver = (facts: DiscoveryFacts) =>
  facts.providerId === "typescript-language-server" &&
  !facts.bundledTypeScript &&
  (facts.sdk !== null || facts.plugins.length > 0) &&
  facts.sdkVersion?.startsWith("7.") !== true;

/** The managed tool serving TypeScript: TypeScript 7's `tsc --lsp`, or tsserver behind typescript-language-server. */
export const typescriptTool = (facts: DiscoveryFacts) =>
  projectTsserver(facts) ? "typescript-language-server" : "typescript-go";

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
  (facts.managedRustLua === true &&
    ["rust-analyzer", "lua-language-server"].includes(facts.providerId) &&
    !facts.workspaceTrusted &&
    configuredExecutable(facts) === undefined) ||
  (facts.managedPython === true &&
    ["basedpyright", "ruff"].includes(facts.providerId) &&
    configuredExecutable(facts) === undefined) ||
  (facts.managedPhp === true &&
    facts.providerId === "phpactor" &&
    configuredExecutable(facts) === undefined);

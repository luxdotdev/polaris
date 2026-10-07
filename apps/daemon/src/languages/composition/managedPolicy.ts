import type { DiscoveryFacts } from "../discovery/index.ts";
import { configuredExecutable } from "./configuredLaunch.ts";

/** The bundled selection runs private TypeScript with Workspace plugin loading disabled. */
export const bundledTypeScript = (facts: DiscoveryFacts) =>
  facts.bundledTypeScript === true &&
  facts.providerId === "typescript-language-server" &&
  configuredExecutable(facts) === undefined;

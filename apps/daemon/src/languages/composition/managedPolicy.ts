import type { DiscoveryFacts } from "../discovery/index.ts";
import { configuredExecutable } from "./configuredLaunch.ts";

/** Slice 1 runs only Polaris's bundled TypeScript, with plugin loading disabled. */
export const bundledTypeScript = (facts: DiscoveryFacts) =>
  facts.bundledTypeScript === true &&
  facts.providerId === "typescript-language-server" &&
  configuredExecutable(facts) === undefined;

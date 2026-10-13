import { LanguageTrustStatus, type LanguageTrust } from "@polaris/protocol";
import type { DiscoveryFacts } from "../discovery/index.ts";
import type { ExecutionTrustService } from "../trust/service.ts";

export function trustStatus(
  facts: DiscoveryFacts,
  trust: typeof LanguageTrust.Type,
  service: ExecutionTrustService["Service"]
) {
  const workspaceTools = [
    facts.svelteConfiguration === null ? null : "Svelte config and preprocessors",
    facts.prisma?.config == null ? null : "Prisma config",
    ...facts.workspaceTools,
  ].filter((tool): tool is string => tool !== null);

  const project = facts.sdk !== null || facts.plugins.length > 0 || workspaceTools.length > 0;

  return LanguageTrustStatus.make({
    trust,
    wouldRun: {
      workspaceTools,
      typescriptVersion: facts.sdkVersion,
      typescriptPath: facts.sdk,
      native: facts.sdkVersion?.startsWith("7.") === true,
      plugins: facts.plugins.map(({ name }) => name),
    },
    ask: project && service.claimAsk(trust),
    provider:
      trust.trusted &&
      project &&
      (workspaceTools.length > 0 || trust.typescriptProvider !== "bundled")
        ? "project"
        : "bundled",
  });
}

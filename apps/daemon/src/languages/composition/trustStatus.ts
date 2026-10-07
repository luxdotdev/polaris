import { LanguageTrustStatus, type LanguageTrust } from "@polaris/protocol";
import type { DiscoveryFacts } from "../discovery/index.ts";
import type { ExecutionTrustService } from "../trust/service.ts";

export function trustStatus(
  facts: DiscoveryFacts,
  trust: typeof LanguageTrust.Type,
  service: ExecutionTrustService["Service"]
) {
  const project = facts.sdk !== null || facts.plugins.length > 0;

  return LanguageTrustStatus.make({
    trust,
    wouldRun: {
      typescriptVersion: facts.sdkVersion,
      typescriptPath: facts.sdk,
      native: facts.sdkVersion?.startsWith("7.") === true,
      plugins: facts.plugins.map(({ name }) => name),
    },
    ask: project && service.claimAsk(trust),
    provider:
      trust.trusted && trust.typescriptProvider !== "bundled" && project ? "project" : "bundled",
  });
}

import { join } from "node:path";
import type { LanguageEffectiveSettings } from "@polaris/protocol";
import { runtimeProbeAdapter } from "../availability/probes.ts";
import { prerequisiteVersions } from "../availability/prerequisiteVersions.ts";
import { runHostVersion } from "../availability/version-process.ts";
import type { VerifiedLaunchPlan } from "../availability/launch.ts";
import type { Tool } from "../catalog/model.ts";
import type { DiscoveryFacts } from "../discovery/index.ts";
import type { HostInstallation, ObservationAdmission } from "../install/host.ts";
import { descriptor, defaultLimits, type InstalledVersion } from "../install/types.ts";
import { checkAbort, failure } from "../install/validation.ts";

export interface ManagedDelivery {
  bind: (host: HostInstallation) => void;
  ensure: (
    settings: typeof LanguageEffectiveSettings.Type,
    admission: ObservationAdmission,
    signal: AbortSignal
  ) => Promise<void>;
  plan: (facts: DiscoveryFacts, installed: InstalledVersion) => Promise<VerifiedLaunchPlan>;
}

function matchesPin(current: InstalledVersion | null, pinned: Tool) {
  if (current === null || current.version !== pinned.version) return false;
  const installed = descriptor(current.descriptor, defaultLimits.metadataBytes).tool;
  const selected = installed.artifacts.find((artifact) => artifact.id === current.artifactId);

  return (
    installed.id === pinned.id &&
    selected !== undefined &&
    pinned.artifacts.some(
      (artifact) =>
        artifact.id === current.artifactId &&
        artifact.integrity === current.integrity &&
        artifact.auditRoot === selected?.auditRoot &&
        artifact.audit === selected.audit
    )
  );
}

export function createManagedDelivery() {
  let host: HostInstallation | undefined;

  const installation = () => {
    if (host === undefined) throw failure("not-ready", "Private runtime is unavailable");

    return host;
  };

  const developerProbes = runtimeProbeAdapter({
    configured: {},
    searchPath: (process.env.PATH ?? "").split(":"),
    versions: prerequisiteVersions,
    run: runHostVersion,
  });

  const privateNode = async () => {
    const installed = await installation().current("node");

    return installed === null
      ? null
      : { executable: join(installed.directory, "bin/node"), version: installed.version };
  };

  const delivery: ManagedDelivery = {
    bind: (value) => {
      host = value;
    },
    async ensure(settings, admission, signal) {
      for (const toolId of ["node", "typescript", "typescript-language-server"]) {
        checkAbort(signal);
        await admission.requireCurrent(signal);

        const current = await installation().current(toolId);
        const pinned = installation().tool(toolId);

        if (matchesPin(current, pinned)) continue;

        if (settings.settings.downloadLanguageToolsAutomatically === false)
          throw failure(
            "not-installed",
            "Download language tools automatically is off; this Host needs the bundled TypeScript tools"
          );

        const handle = await installation().install(
          toolId,
          "encounter",
          admission.requireCurrent,
          signal,
          admission
        );

        await handle.result;
        await admission.requireCurrent(signal);
      }
    },
    async plan(facts, installed) {
      const node = await privateNode();
      const typescript = await installation().current("typescript");

      if (node === null || typescript === null)
        throw failure("not-installed", "Private Node and bundled TypeScript are not installed");
      const entry = join(installed.directory, "lib/cli.mjs");

      return {
        identity: installed.identity,
        entry,
        runtimeExecutable: node.executable,
        launch: {
          executable: node.executable,
          args: [entry, "--stdio"],
          cwd: facts.projectRoot,
          environment: {
            NODE_OPTIONS: `--require ${JSON.stringify(join(typescript.directory, "plugin-guard.cjs"))}`,
            NODE_PATH: "",
            PATH: join(node.executable, ".."),
          },
          initializationOptions: {
            tsserver: {
              path: join(typescript.directory, "lib/tsserver.js"),
              useSyntaxServer: "never",
            },
            disableAutomaticTypingAcquisition: true,
            plugins: [],
          },
        },
      };
    },
  };

  return {
    delivery,
    async observe(
      tool: Tool,
      _phase: "install" | "feature",
      trusted: boolean,
      signal: AbortSignal,
      admission?: ObservationAdmission
    ) {
      const nodeRequirements = tool.requirements.filter((requirement) => requirement.id === "node");
      const others = tool.requirements.filter((requirement) => requirement.id !== "node");
      const node = nodeRequirements.length ? await privateNode() : null;

      const probes = nodeRequirements.map(({ id }) => ({
        id,
        executable: node?.executable ?? null,
        version: node?.version ?? null,
      }));

      probes.push(...(await developerProbes(others, trusted, signal, admission)));

      return { connected: true, probes };
    },
    dispose: () => developerProbes.dispose(),
  };
}

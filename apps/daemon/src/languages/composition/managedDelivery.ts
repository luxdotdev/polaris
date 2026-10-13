import { sqlShellLaunch } from "../sql/launch.ts";
import { phpactorLaunch } from "../php/launch.ts";
import { rustLaunch } from "../rust/launch.ts";
import { rustToolchainIds, rustToolchainProbes } from "../rust/probes.ts";
import { luaLaunch } from "../lua/launch.ts";
import { webLaunch, webProviders, webTools } from "../web/index.ts";
import { Match } from "effect";
import { pythonLaunch } from "../python/launch.ts";
import { createHostPrerequisiteProbe } from "../install/hostStateProbes.ts";
import { interpreterEntry } from "../python/environment.ts";
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

/** Host Prerequisites observed by presence at fixed locations, never by running them. */
const hostPresence = ["shellcheck", "php", "go", "gopls"];

export interface ManagedDelivery {
  bind: (host: HostInstallation) => void;
  ensure: (
    settings: typeof LanguageEffectiveSettings.Type,
    admission: ObservationAdmission,
    signal: AbortSignal,
    providerId?: string
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

export function createManagedDelivery(
  pythonHost?: Parameters<typeof createHostPrerequisiteProbe>[0]
) {
  let host: HostInstallation | undefined;
  const hostPrerequisites = createHostPrerequisiteProbe(pythonHost);

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
    async ensure(settings, admission, signal, providerId = "typescript-language-server") {
      const tools =
        webTools.includes(providerId) || providerId in webProviders
          ? ["node", webProviders[providerId] ?? providerId]
          : Match.value(providerId).pipe(
              Match.when("basedpyright", () => ["node", "basedpyright"]),
              Match.when("ruff", () => ["ruff"]),
              Match.when("phpactor", () => ["phpactor"]),
              Match.when("bash-language-server", () => ["node", "shfmt", "bash-language-server"]),
              Match.when("rust-analyzer", () => ["rust-analyzer"]),
              Match.when("lua-language-server", () => ["lua-language-server"]),
              Match.when("sqllens-language-server", () => [
                "node",
                "sql-formatter",
                "sqllens-language-server",
              ]),
              Match.orElse(() => ["node", "typescript", "typescript-language-server"])
            );

      for (const toolId of tools) {
        checkAbort(signal);
        await admission.requireCurrent(signal);

        const current = await installation().current(toolId);
        const pinned = installation().tool(toolId);

        if (matchesPin(current, pinned)) continue;

        if (settings.settings.downloadLanguageToolsAutomatically === false)
          throw failure(
            "not-installed",
            "Download language tools automatically is off; this Host needs the selected language tools"
          );

        const handle = await installation().install(
          toolId,
          current === null ? "encounter" : "update",
          admission.requireCurrent,
          signal,
          admission
        );

        await handle.result;
        await admission.requireCurrent(signal);
      }
    },
    async plan(facts, installed) {
      // Servers that run on their own binary or the Host's runtime, not the private Node.
      const own = new Map([
        [
          "phpactor",
          () =>
            phpactorLaunch(
              facts,
              installed,
              installation().tool("phpactor").requirements,
              hostPrerequisites
            ),
        ],
        ["rust-analyzer", () => rustLaunch(facts, installed)],
        ["lua-language-server", () => luaLaunch(facts, installed)],
      ]).get(facts.providerId);

      if (own !== undefined) return own();

      const node = facts.providerId === "ruff" ? null : await privateNode();

      if (["basedpyright", "ruff"].includes(facts.providerId))
        return pythonLaunch(facts, installed, node);

      if (["bash-language-server", "sqllens-language-server"].includes(facts.providerId))
        return sqlShellLaunch(facts, installed, node, installation(), hostPrerequisites);

      if (facts.providerId in webProviders) return webLaunch(facts, installed, node);
      const typescript = await installation().current("typescript");

      if (node === null || typescript === null)
        throw failure("not-installed", "Private Node and bundled TypeScript are not installed");
      const entry = join(installed.directory, "lib/cli.mjs");
      const project = !facts.bundledTypeScript && (facts.sdk !== null || facts.plugins.length > 0);

      if (project && facts.sdkVersion?.startsWith("7.")) {
        if (facts.nativeServer === null)
          throw failure(
            "missing-prerequisite",
            "The project's native TypeScript platform package is missing"
          );

        return {
          identity: installed.identity,
          entry: facts.nativeServer,
          launch: {
            executable: facts.nativeServer,
            args: ["--lsp", "--stdio"],
            cwd: facts.projectRoot,
            environment: { NODE_OPTIONS: "", NODE_PATH: "" },
          },
        };
      }

      return {
        identity: installed.identity,
        entry,
        runtimeExecutable: node.executable,
        launch: {
          executable: node.executable,
          args: [entry, "--stdio"],
          cwd: facts.projectRoot,
          environment: {
            NODE_OPTIONS: project
              ? ""
              : `--require ${JSON.stringify(join(typescript.directory, "plugin-guard.cjs"))}`,
            NODE_PATH: "",
            PATH: join(node.executable, ".."),
          },
          initializationOptions: {
            tsserver: {
              path:
                project && facts.tsserver !== null
                  ? facts.tsserver
                  : join(typescript.directory, "lib/tsserver.js"),
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

      const others = tool.requirements.filter(
        (requirement) =>
          !["node", "python-interpreter", ...hostPresence, ...rustToolchainIds].includes(
            requirement.id
          )
      );

      const node = nodeRequirements.length ? await privateNode() : null;

      const probes = nodeRequirements.map(({ id }) => ({
        id,
        executable: node?.executable ?? null,
        version: node?.version ?? null,
      }));

      const python = tool.requirements.find(
        (requirement) => requirement.id === "python-interpreter"
      );

      if (python !== undefined) {
        const entry = admission?.pythonInterpreter;

        const presence =
          entry === undefined ? await hostPrerequisites().probe(python, signal) : null;

        const executable = entry === undefined ? (presence?.path ?? null) : entry;

        if (executable !== null) await interpreterEntry(executable);
        probes.push({ id: python.id, executable, version: executable === null ? null : "present" });
      }

      for (const requirement of tool.requirements.filter(({ id }) => hostPresence.includes(id))) {
        const present = await hostPrerequisites().probe(requirement, signal);
        probes.push({
          id: requirement.id,
          executable: present.path,
          version: present.path === null ? null : "present",
        });
      }

      probes.push(...(await rustToolchainProbes(tool.requirements)));
      probes.push(...(await developerProbes(others, trusted, signal, admission)));

      return { connected: true, probes };
    },
    dispose: () => developerProbes.dispose(),
  };
}

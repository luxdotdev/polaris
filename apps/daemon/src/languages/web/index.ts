import { dirname, join } from "node:path";
import type { DiscoveryFacts } from "../discovery/index.ts";
import type { InstalledVersion } from "../install/types.ts";
import type { VerifiedLaunchPlan } from "../availability/launch.ts";
import { failure } from "../install/validation.ts";

interface WebProviderCatalog {
  readonly [provider: string]: string;
}

export const webProviders: WebProviderCatalog = {
  "vscode-json-language-server": "vscode-langservers-extracted",
  "vscode-css-language-server": "vscode-langservers-extracted",
  "vscode-html-language-server": "vscode-langservers-extracted",
  "yaml-language-server": "yaml-language-server",
  "actions-language-server": "actions-language-server",
  "prisma-language-server": "prisma-language-server",
  "svelte-language-server": "svelte-language-server",
};

export const webTools = [...new Set(Object.values(webProviders))];

export const workflowPath = (path: string) =>
  /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(path);

/** Workflow semantics belong to Actions; YAML retains syntax and explicitly supplied schemas. */
export const webServerSettings = (facts: DiscoveryFacts) => {
  if (facts.providerId === "prisma-language-server") return { prisma: { enableDiagnostics: true } };

  if (facts.providerId === "vscode-css-language-server") {
    const settings = { validate: true, lint: { unknownProperties: "warning" } };

    return { css: settings, scss: settings, less: settings };
  }

  if (facts.providerId === "vscode-json-language-server")
    return {
      json: {
        validate: { enable: true },
        schemas: [
          { fileMatch: ["package.json"], url: "https://json.schemastore.org/package" },
          {
            fileMatch: ["tsconfig.json", "tsconfig.*.json"],
            url: "https://json.schemastore.org/tsconfig",
          },
        ],
      },
    };

  if (facts.providerId === "yaml-language-server")
    return {
      yaml: {
        validate: true,
        hover: true,
        completion: true,
        format: { enable: true },
        schemaStore: { enable: false },
        schemas: {},
      },
    };

  return {};
};

/** Each entry and all npm dependencies are private, receipted upstream bytes. */
export function webLaunch(
  facts: DiscoveryFacts,
  installed: InstalledVersion,
  node: { executable: string } | null
): VerifiedLaunchPlan {
  if (node === null) throw failure("not-installed", "Private Node is unavailable");

  const entry = join(
    installed.directory,
    facts.providerId.startsWith("vscode-")
      ? `bin/${facts.providerId}`
      : facts.providerId === "prisma-language-server"
        ? "dist/bin.js"
        : facts.providerId === "svelte-language-server"
          ? "bin/server.js"
          : facts.providerId === "actions-language-server"
            ? "bin/actions-languageserver"
            : "bin/yaml-language-server"
  );

  return {
    identity: installed.identity,
    entry,
    runtimeExecutable: node.executable,
    launch: {
      executable: node.executable,
      args: [entry, "--stdio"],
      cwd: facts.projectRoot,
      environment: {
        NODE_OPTIONS:
          facts.providerId === "prisma-language-server" && !facts.workspaceTrusted
            ? `--require ${JSON.stringify(join(installed.directory, "prisma-guard.cjs"))}`
            : "",
        NODE_PATH: "",
        JITI_FS_CACHE: "false",
        PATH: dirname(node.executable),
      },
      initializationOptions: initializationOptions(facts),
    },
  };
}

function initializationOptions(facts: DiscoveryFacts) {
  if (facts.providerId === "svelte-language-server")
    return { provideFormatter: true, isTrusted: facts.workspaceTrusted };

  return { provideFormatter: true };
}

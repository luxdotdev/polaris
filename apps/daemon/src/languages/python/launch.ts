import { dirname, join } from "node:path";
import { opendir } from "node:fs/promises";
import { Schema } from "effect";
import type { DiscoveryFacts } from "../discovery/index.ts";
import type { InstalledVersion } from "../install/types.ts";
import { readText } from "../discovery/files.ts";
import { failure } from "../install/validation.ts";
import type { VerifiedLaunchPlan } from "../availability/launch.ts";
import { catalog } from "../catalog/index.ts";

/** Site packages are read from the environment, including uv; no Python process or .pth execution. */
export async function pythonSearchPaths(interpreter: string) {
  const prefix = dirname(dirname(interpreter));
  const paths: string[] = [];

  for (const lib of ["lib", "lib64"]) {
    try {
      let count = 0;

      for await (const entry of await opendir(join(prefix, lib))) {
        if (++count > 32) break;

        if (/^python\d+\.\d+$/.test(entry.name))
          paths.push(join(prefix, lib, entry.name, "site-packages"));
      }
    } catch (cause) {
      if (!Schema.is(Schema.Struct({ code: Schema.Literals(["ENOENT", "ENOTDIR"]) }))(cause))
        throw cause;
    }
  }

  return { prefix, paths: paths.slice(0, 64), version: await venvVersion(prefix) };
}

export async function pythonLaunch(
  facts: DiscoveryFacts,
  installed: InstalledVersion,
  node: { executable: string } | null
): Promise<VerifiedLaunchPlan> {
  if (facts.interpreter === null)
    throw failure("missing-prerequisite", "Python interpreter is missing");

  if (facts.providerId === "ruff") {
    const artifact = catalog.tools
      .find((tool) => tool.id === "ruff")
      ?.artifacts.find((item) => item.id === installed.artifactId);

    if (artifact === undefined) throw failure("audit-required", "Ruff artifact is not pinned");
    const entry = join(installed.directory, artifact.entry);

    return {
      identity: installed.identity,
      entry,
      launch: {
        executable: entry,
        args: ["server"],
        cwd: facts.projectRoot,
        environment: {},
        initializationOptions: { settings: {} },
      },
    };
  }

  if (node === null) throw failure("not-installed", "Private Node is unavailable");
  const entry = join(installed.directory, "langserver.index.js");
  const environment = await pythonSearchPaths(facts.interpreter);

  return {
    identity: installed.identity,
    entry,
    runtimeExecutable: node.executable,
    launch: {
      executable: node.executable,
      args: [entry, "--stdio"],
      cwd: facts.projectRoot,
      environment: {
        NODE_OPTIONS: `--require ${JSON.stringify(join(installed.directory, "python-guard.cjs"))}`,
        NODE_PATH: "",
        PATH: dirname(node.executable),
        POLARIS_PYTHON_PREFIX: environment.prefix,
        POLARIS_PYTHON_VERSION: JSON.stringify(environment.version),
        POLARIS_PYTHON_SEARCH_PATHS: JSON.stringify(environment.paths),
      },
    },
  };
}

/** Disable overlapping lint/import work; Ruff is the sole formatter and import organizer. */
export const pythonServerSettings = (facts: DiscoveryFacts) => ({
  python: { pythonPath: facts.interpreter },
  basedpyright: {
    disableOrganizeImports: true,
    analysis: {
      diagnosticMode: "openFilesOnly",
      typeCheckingMode: "standard",
      diagnosticSeverityOverrides: {
        reportUnusedImport: "none",
        reportUnusedVariable: "none",
        reportDuplicateImport: "none",
      },
    },
  },
});

async function venvVersion(prefix: string) {
  try {
    const config = await readText(join(prefix, "pyvenv.cfg"));
    const version = /^version\s*=\s*(3)\.(\d{1,2})\.(\d{1,3})\s*$/m.exec(config);

    return version === null
      ? null
      : [Number(version[1]), Number(version[2]), Number(version[3]), "final", 0];
  } catch (cause) {
    if (!Schema.is(Schema.Struct({ code: Schema.Literals(["ENOENT", "ENOTDIR"]) }))(cause))
      throw cause;

    return null;
  }
}

import { dirname, join } from "node:path";
import type { DiscoveryFacts } from "../discovery/index.ts";
import type { VerifiedLaunchPlan } from "../availability/launch.ts";
import type { InstalledVersion } from "../install/types.ts";
import type { HostInstallation } from "../install/host.ts";
import { createHostPrerequisiteProbe } from "../install/hostStateProbes.ts";
import { failure } from "../install/validation.ts";

export async function sqlShellLaunch(
  facts: DiscoveryFacts,
  installed: InstalledVersion,
  node: { executable: string } | null,
  host: HostInstallation,
  probeOptions?: Parameters<typeof createHostPrerequisiteProbe>[0]
): Promise<VerifiedLaunchPlan> {
  if (node === null) throw failure("not-installed", "Private Node is unavailable");

  const sql = facts.providerId === "sqllens-language-server";
  const companion = await host.current(sql ? "sql-formatter" : "shfmt");

  if (companion === null) throw failure("not-installed", "Managed formatter is unavailable");

  const requirement = host
    .tool("bash-language-server")
    .requirements.find((item) => item.id === "shellcheck");

  const presence =
    sql || requirement === undefined
      ? null
      : await createHostPrerequisiteProbe(probeOptions)().probe(
          requirement,
          AbortSignal.timeout(2000)
        );

  const entry = join(installed.directory, sql ? "polaris-sql.mjs" : "out/cli.js");

  const launch: VerifiedLaunchPlan["launch"] = {
    executable: node.executable,
    args: [entry, sql ? "--stdio" : "start"],
    cwd: facts.projectRoot,
    environment: {
      NODE_OPTIONS: "",
      NODE_PATH: "",
      PATH: dirname(node.executable),
      SQLLENS_NO_PLUGINS: "1",
      SQLLENS_TRACE_SYNC: "",
      SQLLENS_USER_CONFIG: join(installed.directory, "polaris-no-user-config.json"),
      POLARIS_SQL_DIALECT: facts.sqlDialect ?? "generic",
      POLARIS_SQL_FORMATTER: join(companion.directory, "dist/cjs/index.js"),
      SHELLCHECK_PATH: presence?.path ?? "",
      SHFMT_PATH: join(companion.directory, "shfmt"),
      EXPLAINSHELL_ENDPOINT: "",
      BACKGROUND_ANALYSIS_MAX_FILES: "0",
      SHELLCHECK_EXTERNAL_SOURCES: "false",
      SHFMT_IGNORE_EDITORCONFIG: "true",
    },
  };

  if (!sql)
    launch.initializationOptions = {
      shellcheckPath: presence?.path ?? "",
      shellcheckExternalSources: false,
      shellcheckArguments: ["--norc"],
      explainshellEndpoint: "",
      backgroundAnalysisMaxFiles: 0,
      shfmt: { path: join(companion.directory, "shfmt"), ignoreEditorconfig: true },
    };

  return { identity: installed.identity, entry, runtimeExecutable: node.executable, launch };
}

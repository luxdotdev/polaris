import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DiscoveryFacts } from "../discovery/index.ts";
import type { VerifiedLaunchPlan } from "../availability/launch.ts";
import type { Requirement } from "../catalog/model.ts";
import type { InstalledVersion } from "../install/types.ts";
import type { createHostPrerequisiteProbe } from "../install/hostStateProbes.ts";
import { failure } from "../install/validation.ts";

/** Optional Phpactor extensions; each runs a project tool, so none starts before Trust. */
const projectToolExtensions = [
  "language_server_phpstan",
  "language_server_psalm",
  "language_server_php_cs_fixer",
  "language_server_mago",
  "php_code_sniffer",
  "behat",
  "symfony",
  "prophecy",
];

/** A path that can never be created, so Phpactor's own trust store stays empty and unwritable. */
export const untrustedDataHome = "/dev/null/polaris-phpactor";

/** Before Trust: no Phpactor trust store, and no git run that could read the project's config. */
export const untrustedEnvironment = {
  PHPACTOR_UNCONDITIONAL_TRUST: "",
  XDG_DATA_HOME: untrustedDataHome,
  GIT_DIR: untrustedDataHome,
};

const executable = async (path: string) => {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, constants.X_OK);

    return true;
  } catch {
    return false;
  }
};

/** Phpactor's options override every config file, so the untrusted subset holds whatever the project ships. */
export async function phpactorOptions(
  facts: Pick<DiscoveryFacts, "projectRoot" | "workspaceTrusted">
) {
  const common = {
    "language_server.enable_trust_check": false,
    "language_server_configuration.auto_config": false,
  };

  // Phpactor's subprocesses rebuild config without these options, so before Trust nothing forks.
  if (!facts.workspaceTrusted)
    return {
      ...common,
      "composer.enable": false,
      "language_server.diagnostic_outsource": false,
      "language_server.code_action_outsource": false,
      "indexer.parallel_workers": 1,
      ...Object.fromEntries(projectToolExtensions.map((name) => [`${name}.enabled`, false])),
    };

  const fixer = join(facts.projectRoot, "vendor/bin/php-cs-fixer");

  return (await executable(fixer))
    ? { ...common, "language_server_php_cs_fixer.enabled": true }
    : common;
}

export async function phpactorLaunch(
  facts: DiscoveryFacts,
  installed: InstalledVersion,
  requirements: readonly Requirement[],
  probes: ReturnType<typeof createHostPrerequisiteProbe>
): Promise<VerifiedLaunchPlan> {
  const requirement = requirements.find((item) => item.id === "php");

  const php =
    requirement === undefined
      ? null
      : (await probes().probe(requirement, AbortSignal.timeout(2000))).path;

  if (php === null) throw failure("missing-prerequisite", "PHP is not on this Host");
  const entry = join(installed.directory, "phpactor.phar");

  return {
    identity: installed.identity,
    entry,
    runtimeExecutable: php,
    launch: {
      executable: php,
      args: [entry, "language-server"],
      cwd: facts.projectRoot,
      environment: facts.workspaceTrusted
        ? { PHPACTOR_UNCONDITIONAL_TRUST: "1" }
        : untrustedEnvironment,
      initializationOptions: await phpactorOptions(facts),
    },
  };
}

/**
 * The machines feature in the main process: `Machines` wired to this app's
 * files, the system `ssh`, the Daemon builds and macOS Terminal. See
 * `README.md` in this folder.
 */
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Ssh } from "@polaris/client/install";
import { shell } from "electron";
import type { LocalDaemon } from "../localDaemon.ts";
import { approvalsPath, openApprovals } from "./approvals.ts";
import { locateBuilds } from "./builds.ts";
import { Machines, type SettingsStore } from "./service.ts";
import { readSshAliases } from "./sshConfig.ts";
import { terminalScript } from "./terminal.ts";

export { Machines } from "./service.ts";

/** Whose `~/.ssh/config` lists the aliases: `POLARIS_DESKTOP_SSH_HOME` in tests, else the user's. */
const sshHome = (env: Record<string, string | undefined>) =>
  env.POLARIS_DESKTOP_SSH_HOME ?? homedir();

/** The literal Host aliases (Include followed), for onboarding's "found on this Mac". */
export const sshAliasNames = (env: Record<string, string | undefined>): ReadonlyArray<string> =>
  readSshAliases(sshHome(env)).map((a) => a.alias);

export interface MachinesLayerInput {
  readonly settings: SettingsStore;
  readonly userData: string;
  readonly env: Record<string, string | undefined>;
  /** `process.resourcesPath` when packaged. */
  readonly resources: string | null;
  readonly repoRoot: string;
  readonly dev: boolean;
  readonly localDaemon: () => Promise<LocalDaemon>;
}

/** Runs `argv` in a new Terminal window, through a `.command` file macOS opens there. */
const openTerminal = async (argv: ReadonlyArray<string>) => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-terminal-"));
  const script = join(dir, "polaris.command");

  writeFileSync(script, terminalScript(argv));
  chmodSync(script, 0o700);
  const error = await shell.openPath(script);

  if (error !== "") throw new Error(error);
};

export const machinesLayer = (input: MachinesLayerInput) =>
  Machines.layer({
    settings: input.settings,
    approvals: openApprovals(approvalsPath(input.userData)),
    builds: locateBuilds({
      env: input.env,
      resources: input.resources,
      repoRoot: input.repoRoot,
      buildOnDemand: input.dev,
    }),
    aliases: () => readSshAliases(sshHome(input.env)),
    localDaemon: input.localDaemon,
    openTerminal,
    ssh: Ssh.layer,
  });

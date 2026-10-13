/**
 * The machines feature in the main process: `Machines` wired to this app's
 * files, the system `ssh`, the Daemon builds and the Client's terminal. See
 * `README.md` in this folder.
 */
import { homedir } from "node:os";
import { Ssh } from "@polaris/client/install";
import { discoverDistros, wslInstallLayer } from "@polaris/client/wsl";
import { shell } from "electron";
import type { LocalDaemon } from "../localDaemon.ts";
import { approvalsPath, openApprovals } from "./approvals.ts";
import { locateBuilds } from "./builds.ts";
import { Machines, type SettingsStore } from "./service.ts";
import { readSshAliases } from "./sshConfig.ts";
import { openClientTerminal } from "./terminal.ts";

export { Machines } from "./service.ts";

/** Whose `~/.ssh/config` lists the aliases: `POLARIS_DESKTOP_SSH_HOME` in tests, else the user's. */
const sshHome = (env: Record<string, string | undefined>) =>
  env.POLARIS_DESKTOP_SSH_HOME ?? homedir();

/** The literal Host aliases (Include followed), for onboarding's "found on this Mac". */
export const sshAliasNames = (env: Record<string, string | undefined>): ReadonlyArray<string> =>
  readSshAliases(sshHome(env)).map((a) => a.alias);

export interface MachinesLayerInput {
  readonly platform?: NodeJS.Platform;
  readonly settings: SettingsStore;
  readonly userData: string;
  readonly env: Record<string, string | undefined>;
  /** `process.resourcesPath` when packaged. */
  readonly resources: string | null;
  readonly repoRoot: string;
  readonly dev: boolean;
  readonly localDaemon: () => Promise<LocalDaemon>;
  readonly localHome: () => string | null;
  readonly localListening: (home: string) => Promise<void>;
}

export const machinesLayer = (input: MachinesLayerInput) =>
  Machines.layer({
    platform: input.platform ?? process.platform,
    sshBinary: input.settings.get().sshBinary,
    settings: input.settings,
    approvals: openApprovals(approvalsPath(input.userData)),
    builds: locateBuilds({
      env: input.env,
      resources: input.resources,
      repoRoot: input.repoRoot,
      buildOnDemand: input.dev,
    }),
    aliases: () => readSshAliases(sshHome(input.env), { platform: input.platform, env: input.env }),
    localDaemon: input.localDaemon,
    localHome: input.localHome,
    localListening: input.localListening,
    openTerminal: (argv) =>
      openClientTerminal(argv, input.platform ?? process.platform, {
        env: input.env,
        openPath: (path) => shell.openPath(path),
      }),
    ssh: Ssh.withOptions({ platform: input.platform, sshBinary: input.settings.get().sshBinary }),
    wsl: {
      ssh: wslInstallLayer({ env: input.env }),
      discover: discoverDistros({ env: input.env, platform: input.platform }),
    },
  });

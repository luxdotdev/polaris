/**
 * The machines feature in the main process: `Machines` wired to this app's
 * files, the system `ssh`, the Daemon builds and the Client's terminal. See
 * `README.md` in this folder.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { HostAccess } from "@polaris/client/access";
import { downloadBuild } from "@polaris/client/install";
import { discoverDistros } from "@polaris/client/wsl";
import { Layer } from "effect";
import { shell } from "electron";
import type { LocalHost } from "../local/index.ts";
import { internetFetch } from "../net.ts";
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
  /** Sent with Daemon downloads for the site's telemetry. */
  readonly appVersion?: string;
  readonly env: Record<string, string | undefined>;
  /** `process.resourcesPath` when packaged. */
  readonly resources: string | null;
  readonly repoRoot: string;
  readonly dev: boolean;
  /** This Client's local Host, if it can have one (`LocalHost.forPlatform`). */
  readonly localHost: Layer.Layer<LocalHost>;
}

export const machinesLayer = (input: MachinesLayerInput) =>
  Machines.layer({
    platform: input.platform ?? process.platform,
    settings: input.settings,
    approvals: openApprovals(approvalsPath(input.userData)),
    // Release builds bundle only this machine's Daemon; a Host that can't download its own gets it from here.
    download: downloadBuild({
      cacheDir: join(input.userData, "daemon-builds"),
      clientVersion: input.appVersion,
      fetch: internetFetch,
    }),
    clientVersion: input.appVersion,
    builds: locateBuilds({
      env: input.env,
      resources: input.resources,
      repoRoot: input.repoRoot,
      buildOnDemand: input.dev,
    }),
    aliases: () => readSshAliases(sshHome(input.env), { platform: input.platform, env: input.env }),
    openTerminal: (argv) =>
      openClientTerminal(argv, input.platform ?? process.platform, {
        env: input.env,
        openPath: (path) => shell.openPath(path),
      }),
    discoverWsl: discoverDistros({ env: input.env, platform: input.platform }),
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        HostAccess.layer({
          platform: input.platform ?? process.platform,
          ssh: { sshBinary: input.settings.get().sshBinary },
          wsl: { env: input.env },
        }),
        input.localHost
      )
    )
  );

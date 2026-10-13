import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DiscoveryFacts } from "../discovery/index.ts";
import type { InstalledVersion } from "../install/types.ts";
import type { VerifiedLaunchPlan } from "../availability/launch.ts";
import { luaStatePaths } from "./settings.ts";

/**
 * The upstream binary, with its state kept outside the verified install. Before Trust LuaLS asks
 * the Client before loading a .luarc plugin and the Client declines; after Trust it loads it.
 */
export async function luaLaunch(
  facts: Pick<DiscoveryFacts, "projectRoot" | "workspaceTrusted">,
  installed: Pick<InstalledVersion, "identity" | "directory">
): Promise<VerifiedLaunchPlan> {
  const entry = join(installed.directory, "bin/lua-language-server");
  const state = luaStatePaths(dirname(dirname(installed.directory)));
  await mkdir(state.log, { recursive: true, mode: 0o700 });
  await mkdir(state.meta, { recursive: true, mode: 0o700 });

  return {
    identity: installed.identity,
    entry,
    launch: {
      executable: entry,
      args: [`--logpath=${state.log}`, `--metapath=${state.meta}`],
      cwd: facts.projectRoot,
      environment: {},
      initializationOptions: { trustByClient: facts.workspaceTrusted },
    },
  };
}

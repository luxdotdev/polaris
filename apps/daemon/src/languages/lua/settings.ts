import { join } from "node:path";
import { nearest, readText } from "../discovery/files.ts";

const PLUGIN =
  /"(?:Lua\.)?runtime\.plugin"\s*:\s*(?:"[^"\s]|\[\s*")|"plugin"\s*:\s*(?:"[^"\s]|\[\s*")/;

/** The project's .luarc plugin, which LuaLS runs as Lua code: read as text, never evaluated. */
export async function luaPlugin(root: string, projectRoot: string) {
  const found = await nearest(root, [projectRoot], [".luarc.json", ".luarc.jsonc"]);

  if (found === null) return null;

  return PLUGIN.test(await readText(found.path)) ? found.path : null;
}

/** No telemetry, no prompts that write settings, no bundled third-party library detection. */
export const luaServerSettings = () => ({
  Lua: {
    telemetry: { enable: false },
    workspace: { checkThirdParty: "Disable" },
    format: { enable: true },
    completion: { callSnippet: "Replace" },
    hover: { enable: true },
  },
});

/** LuaLS writes logs, its plugin trust list and generated metadata here, never into its install. */
export const luaStatePaths = (toolRoot: string) => ({
  log: join(toolRoot, "state", "log"),
  meta: join(toolRoot, "state", "meta"),
});

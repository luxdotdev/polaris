import { luaPlugin } from "../lua/settings.ts";
import { rustCrates } from "./project.ts";

/** Discovery's Rust and Lua facts: the crates analysed before Trust, and a .luarc plugin. */
export const rustLuaFacts = async (
  root: string,
  projectRoot: string,
  provider: string,
  workspaceTrusted: boolean,
  { managed }: { readonly managed: boolean }
) => ({
  managedRustLua: managed && (provider === "rust" || provider === "lua"),
  rustCrates: provider === "rust" && !workspaceTrusted ? await rustCrates(root, projectRoot) : null,
  luaPlugin: provider === "lua" ? await luaPlugin(root, projectRoot) : null,
});

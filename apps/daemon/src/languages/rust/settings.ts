import { LanguageJsonObject } from "@polaris/protocol";
import { Schema } from "effect";
import type { DiscoveryFacts } from "../discovery/index.ts";
import { luaServerSettings } from "../lua/settings.ts";
import type { Launch } from "../runtime/process.ts";
import { managedSqlShellSettings } from "../sql/settings.ts";

/** Before Trust nothing builds or checks; the project is the crates read from Cargo.toml. */
const UNTRUSTED = {
  cargo: { buildScripts: { enable: false } },
  procMacro: { enable: false },
  checkOnSave: false,
  cachePriming: { enable: false },
};

/** What the Rust and Lua settings read of discovery's facts. */
export type SettingsFacts = Pick<
  DiscoveryFacts,
  "providerId" | "workspaceTrusted" | "managedRustLua"
> & {
  readonly effectiveSettings: {
    readonly settings: Pick<DiscoveryFacts["effectiveSettings"]["settings"], "serverSettings">;
  };
};

const configured = (facts: SettingsFacts) =>
  facts.effectiveSettings.settings.serverSettings?.[facts.providerId];

/** rust-analyzer's options; before Trust the safety keys win over any user setting. */
export const rustAnalyzerOptions = (facts: SettingsFacts, linkedProject: string | null) => {
  const value = configured(facts)?.["rust-analyzer"];
  const user = Schema.is(LanguageJsonObject)(value) ? value : {};

  if (facts.workspaceTrusted) return Object.assign({}, user);

  return Object.assign({}, user, UNTRUSTED, {
    linkedProjects: linkedProject === null ? [] : [linkedProject],
  });
};

/** The settings a server's launch answers with: SQL and Shell's, Rust and Lua's, or the default. */
export const launchSettings = <A>(facts: DiscoveryFacts, launch: Launch, otherwise: () => A) =>
  managedSqlShellSettings(facts, launch) ?? managedRustLuaSettings(facts, launch) ?? otherwise();

/** rust-analyzer replaces its options with this answer, so it repeats the launch's. */
export const managedRustLuaSettings = (facts: SettingsFacts, launch: Launch) => {
  if (facts.managedRustLua !== true) return undefined;

  if (facts.providerId === "lua-language-server")
    return Object.assign({}, luaServerSettings(), configured(facts));

  return facts.providerId === "rust-analyzer" && launch.initializationOptions !== undefined
    ? { "rust-analyzer": launch.initializationOptions }
    : undefined;
};

/**
 * How the menu names what a command does and where it comes from. A command
 * Polaris runs itself says what Polaris does, not what the Harness's TUI would.
 */
import type { PolarisAction } from "@polaris/protocol";
import type { CommandOption } from "./commands.ts";

const ACTIONS: Readonly<Record<PolarisAction, string>> = {
  "new-session": "Start a new session here",
  model: "Choose the model and effort",
  fast: "Toggle fast mode (higher usage cost)",
  diff: "Show this turn's changes",
  usage: "Open usage",
};

export const describe = (option: CommandOption): string =>
  option.action === null ? option.description : ACTIONS[option.action];

/** A trailing hint for where it comes from; built-in ones need none. */
export const sourceLabel = (option: CommandOption): string | null => {
  if (option.source === "plugin") return option.plugin ?? "plugin";

  return option.source === "built-in" ? null : option.source;
};

/**
 * What the `/` menu says instead of a list when the Host's Daemon is too old
 * to list Skills and Slash Commands (no `harness.commands`), and the one action
 * that fixes it: Settings → Hosts, where the Host's daemon updates. Also where
 * a `/` belongs when nothing listed can go mid-message.
 */
import type { InstallFlowView } from "../../../../shared/api.ts";
import { type CommandOption, type CommandToken, commandHead, placeable } from "./commands.ts";

export interface CommandNotice {
  readonly message: string;
  readonly action: { readonly label: string; readonly run: () => void } | null;
}

export const daemonNotice = (
  hostLabel: string,
  install: InstallFlowView | null,
  openHosts: () => void
): CommandNotice => {
  const step = install?.step ?? "idle";

  if (step === "checking" || step === "installing")
    return { message: `Upgrading the daemon on ${hostLabel}…`, action: null };

  if (step === "blocked")
    return {
      message: `Couldn't upgrade the daemon on ${hostLabel}: ${install?.problem?.message ?? "it failed"}`,
      action: { label: "See why", run: openHosts },
    };

  // Upgraded: the Host reconnects, and with it come the Skills.
  if (install?.outcome?.kind === "upgraded")
    return { message: `Daemon upgraded on ${hostLabel}; reconnecting…`, action: null };

  return {
    message: `Skills need a newer daemon on ${hostLabel}`,
    action: { label: "Upgrade daemon", run: openHosts },
  };
};

/** Mid-message, where nothing listed can go: a `/` there is said to belong at the start. */
const placementNotice = (
  atHead: boolean,
  tokens: ReadonlyArray<CommandToken>,
  options: ReadonlyArray<CommandOption>
): CommandNotice | null => {
  const slashes = options.filter((o) => o.sigil === "/");
  const head = commandHead(atHead, tokens);

  if (head || slashes.length === 0 || slashes.some((o) => placeable(o, head))) return null;

  return {
    message: options.some((o) => o.sigil === "$")
      ? "Skills here start with $; / commands go at the start of a message"
      : "/ commands go at the start of a message",
    action: null,
  };
};

/**
 * What a `/` word says instead of a list: the Host's `daemon` notice wherever
 * the list would open, else, for a bare `/` mid-message, where commands go.
 */
export const noticeFor = (
  word: string,
  atHead: boolean,
  tokens: ReadonlyArray<CommandToken>,
  daemon: CommandNotice | null,
  options: ReadonlyArray<CommandOption>
): CommandNotice | null => {
  if (!/^\/\S*$/.test(word)) return null;

  if (daemon !== null) return daemon;

  return word === "/" ? placementNotice(atHead, tokens, options) : null;
};

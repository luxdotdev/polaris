/**
 * What the `/` menu says instead of a list when the Host's Daemon is too old
 * to list Skills and Slash Commands (no `harness.commands`), and the one action
 * that fixes it: the Host's own upgrade, as Settings → Hosts runs it.
 */
import type { InstallFlowView } from "../../../../shared/api.ts";
import { type CommandToken, sigilOpen } from "./commands.ts";

export interface CommandNotice {
  readonly message: string;
  readonly action: { readonly label: string; readonly run: () => void } | null;
}

export const daemonNotice = (
  hostLabel: string,
  install: InstallFlowView | null,
  upgrade: () => void
): CommandNotice => {
  const step = install?.step ?? "idle";

  if (step === "checking" || step === "installing")
    return { message: `Upgrading the daemon on ${hostLabel}…`, action: null };

  if (step === "blocked")
    return {
      message: `Couldn't upgrade the daemon on ${hostLabel}: ${install?.problem?.message ?? "it failed"}`,
      action: { label: "Try again", run: upgrade },
    };

  // Upgraded: the Host reconnects, and with it come the Skills.
  if (install?.outcome?.kind === "upgraded")
    return { message: `Daemon upgraded on ${hostLabel}; reconnecting…`, action: null };

  return {
    message: `Skills need a newer daemon on ${hostLabel}`,
    action: { label: "Upgrade daemon", run: upgrade },
  };
};

/** Where the notice shows: wherever a `/` word would open the list. */
export const noticeOpens = (word: string, atHead: boolean, tokens: ReadonlyArray<CommandToken>) =>
  /^\/\S*$/.test(word) && sigilOpen("/", atHead, tokens);

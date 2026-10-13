/**
 * What `Machines` says about a Host's `HostChannel`: the card's activity while it checks
 * and copies, and why an action has no channel. Pure; `HostAccess` decides the channel.
 */
import type { HostActionUnsupported, HostChannel } from "@polaris/client/access";
import { Match } from "effect";
import type { ClientCopy } from "../../shared/clientCopy.ts";
import { COPYING_WSL, PROBING_WSL } from "./wsl.ts";

/** What a check is doing while it runs, under the card's "Checking <host>". */
const PROBING = "Asking over SSH for the platform and any installed daemon.";

const COPYING = "Copying the build over SSH and checking its SHA-256";

const COPYING_LOCAL = "Copying the build and checking its SHA-256";

export interface ChannelActivity {
  readonly probing: string;
  readonly copying: string;
}

export const channelActivity = (channel: HostChannel, copy: ClientCopy): ChannelActivity =>
  Match.value(channel.kind).pipe(
    Match.when("local", () => ({
      probing: `Checking the daemon installed on ${copy.machine}.`,
      copying: COPYING_LOCAL,
    })),
    Match.when("wsl", () => ({ probing: PROBING_WSL, copying: COPYING_WSL })),
    Match.when("ssh", () => ({ probing: PROBING, copying: COPYING })),
    Match.exhaustive
  );

/** The local Host is the app's own dev Daemon or a given socket, which Polaris never touches. */
export const unmanagedLocal = (copy: ClientCopy): string =>
  `${copy.machine}'s daemon is the app's own, not one Polaris installed`;

/** Why there's no channel for the action, in the Settings row's words. */
export const unsupportedMessage = (error: HostActionUnsupported, copy: ClientCopy): string =>
  Match.value(error.reason).pipe(
    Match.when("local-unsupported", () => copy.localHostUnsupported),
    Match.when("unmanaged-local", () => unmanagedLocal(copy)),
    Match.when("no-terminal", () => `${copy.localHost} needs no ssh hand-off`),
    Match.exhaustive
  );

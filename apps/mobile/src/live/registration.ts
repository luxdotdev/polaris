/**
 * Registers the Live Activity's update token with a Host (`devices.registerLiveActivity`), so
 * its Daemon can push this Host's sealed slice through the Relay (docs/adr/0088).
 */
import type {
  LiveActivityRegistration,
  PushEnvironment,
  RelayAddress,
} from "@polaris/protocol/relay";
import { type RelayIdentity, signLiveTicket } from "@polaris/protocol/relay/party";
import type { HostConnection } from "../runtime/hostConnection.ts";
import { UNREGISTER_WAIT_MS } from "../push/registration.ts";

export interface LiveDevice {
  /** The activity's update token, lowercase hex. */
  readonly token: string;
  readonly environment: PushEnvironment;
  readonly pushKey: string;
  readonly identity: RelayIdentity;
}

export const liveRegistration = (
  device: LiveDevice,
  hostAddress: RelayAddress
): LiveActivityRegistration => ({
  token: device.token,
  environment: device.environment,
  pushKey: device.pushKey,
  ticket: signLiveTicket(device.identity, hostAddress, device.environment, device.token),
});

export const registerLiveActivity = (
  host: Pick<HostConnection, "run">,
  device: LiveDevice,
  hostAddress: RelayAddress
): Promise<void> =>
  host.run((client) =>
    client["devices.registerLiveActivity"](liveRegistration(device, hostAddress))
  );

/** Best effort, before an unlink closes the connections, like unregisterPush. */
export const unregisterLiveActivity = (
  hosts: ReadonlyArray<Pick<HostConnection, "run">>,
  waitMs = UNREGISTER_WAIT_MS
): Promise<void> =>
  Promise.all(
    hosts.map((host) =>
      Promise.race([
        host.run((client) => client["devices.unregisterLiveActivity"]()).catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
      ])
    )
  ).then(() => undefined);

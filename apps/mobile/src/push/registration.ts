/**
 * Registers this device for push with a Host (apps/daemon/src/push/README.md): its APNs token
 * and environment, its push key, and a ticket its relay identity signs for that Host's address.
 */
import type { PushEnvironment, PushRegistration, RelayAddress } from "@polaris/protocol/relay";
import { type RelayIdentity, signPushTicket } from "@polaris/protocol/relay/party";
import type { HostConnection } from "../runtime/hostConnection.ts";

export interface PushDevice {
  readonly token: string;
  readonly environment: PushEnvironment;
  readonly pushKey: string;
  readonly identity: RelayIdentity;
}

export const pushRegistration = (
  device: PushDevice,
  hostAddress: RelayAddress
): PushRegistration => ({
  token: device.token,
  environment: device.environment,
  pushKey: device.pushKey,
  ticket: signPushTicket(device.identity, hostAddress, device.environment, device.token),
});

/** Re-registering replaces the Host's registration for this device (a new token or key). */
export const registerPush = (
  host: HostConnection,
  device: PushDevice,
  hostAddress: RelayAddress
): Promise<void> =>
  host.run((client) => client["devices.registerPush"](pushRegistration(device, hostAddress)));

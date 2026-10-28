/** A linked Host's HostTransport: a Noise session through the Polaris Relay. */
import type { LinkedHost, RelayDevice } from "@polaris/client/relay";
import type { HostTransport } from "../runtime/hostConnection.ts";

export const relayTransport = (device: RelayDevice, host: LinkedHost): HostTransport => ({
  route: "relay",
  open: device.transport(host),
});

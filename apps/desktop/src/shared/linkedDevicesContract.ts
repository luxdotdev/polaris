/**
 * Settings → Devices and each Host's Polaris Relay route over IPC (ENG-461). Per-Host
 * methods forward the Daemon RPC of the same name; `devices.startLink` and
 * `devices.finishLink` link through one Host and share the device to the rest.
 */
import { LinkedDevice, type RelayRouteStatus } from "@polaris/protocol";
import { Schema } from "effect";
import type { Plain } from "./api.ts";

const HostKey = Schema.String.check(Schema.isMinLength(1));

const OnHost = Schema.Struct({ hostKey: HostKey });

export const LinkedDevicesRequestInputs = {
  "relayRoute.status": OnHost,
  "relayRoute.enable": Schema.Struct({ hostKey: HostKey, url: Schema.String }),
  "relayRoute.disable": OnHost,
  "devices.list": OnHost,
  /** Opens a link on the first Host with the route on; the result holds a one-time secret. */
  "devices.startLink": Schema.Struct({}),
  /** Waits for the device, then shares it to `shareTo` with `devices.add`. */
  "devices.finishLink": Schema.Struct({
    hostKey: HostKey,
    linkId: Schema.String,
    shareTo: Schema.Array(HostKey),
  }),
  /** Ends an unused link on its Host, so its secret stops working: Cancel, or leaving the page. */
  "devices.cancelLink": Schema.Struct({ hostKey: HostKey, linkId: Schema.String }),
  /** Shares a device another Host linked: "Retry" on a Host it didn't reach. */
  "devices.share": Schema.Struct({
    hostKey: HostKey,
    name: Schema.String,
    relayAddress: LinkedDevice.fields.relayAddress,
    noiseKey: LinkedDevice.fields.noiseKey,
  }),
  "devices.unlink": Schema.Struct({ hostKey: HostKey, id: LinkedDevice.fields.id }),
} as const;

export type LinkedDevicesMethod = keyof typeof LinkedDevicesRequestInputs;

export type LinkedDeviceView = Plain<LinkedDevice>;

export type RelayRouteView = Plain<RelayRouteStatus>;

export interface LinkOfferView {
  /** The Host the device links through. */
  readonly hostKey: string;
  readonly linkId: string;
  /** `polaris-link:v2:…`, for the QR code and "Copy link". Never log it. */
  readonly linkString: string;
  readonly expiresAt: string;
  /** The other Hosts in the link, which `devices.finishLink` shares the device to. */
  readonly shareTo: ReadonlyArray<string>;
}

export interface LinkResultView {
  readonly device: LinkedDeviceView;
  /** Each `shareTo` Host, and whether `devices.add` reached it. */
  readonly shares: ReadonlyArray<{ readonly hostKey: string; readonly ok: boolean }>;
}

export type LinkedDevicesRequestOutputs = {
  readonly "relayRoute.status": RelayRouteView;
  readonly "relayRoute.enable": RelayRouteView;
  readonly "relayRoute.disable": RelayRouteView;
  readonly "devices.list": ReadonlyArray<LinkedDeviceView>;
  readonly "devices.startLink": LinkOfferView;
  readonly "devices.finishLink": LinkResultView;
  readonly "devices.cancelLink": void;
  readonly "devices.share": LinkedDeviceView;
  readonly "devices.unlink": LinkedDeviceView;
};

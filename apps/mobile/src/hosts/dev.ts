/**
 * Paper MX-AD's four Hosts for screenshots, in a development build launched with
 * `-polarisDevHosts paper`; `-polarisDevHostSheet <name>` opens that Host's details sheet.
 */
import { Schema } from "effect";
import { Platform, Settings } from "react-native";
import type { HostInput } from "./model.ts";

const launched = (key: string): string | null => {
  if (!__DEV__ || Platform.OS !== "ios") return null;
  const value: unknown = Settings.get(key);

  return Schema.is(Schema.String)(value) ? value : null;
};

const LAUNCHED_AT = Date.now();

/** The fixture Hosts, or null in a release build or a normal launch. */
export const DEV_HOSTS: ReadonlyArray<HostInput> | null =
  launched("polarisDevHosts") === "paper"
    ? [
        {
          hostId: "lucas-rpi",
          name: "lucas-rpi",
          route: "relay",
          state: "reconnecting",
          failure: "relay: tunnel closed by peer (ECONNRESET)",
          latencyMs: null,
          lastSeenAt: LAUNCHED_AT - 42_000,
          sessions: 3,
        },
        {
          hostId: "build-vm",
          name: "build-vm-ubuntu-2404-arm64",
          route: "relay",
          state: "offline",
          failure: null,
          latencyMs: null,
          lastSeenAt: LAUNCHED_AT - 3 * 3600_000,
          sessions: null,
        },
        {
          hostId: "mac-studio",
          name: "mac-studio",
          route: "dev-bridge",
          state: "connected",
          failure: null,
          latencyMs: 4,
          lastSeenAt: LAUNCHED_AT - 2 * 3600_000,
          sessions: 6,
        },
        {
          hostId: "gpu-box",
          name: "gpu-box",
          route: "relay",
          state: "connected",
          failure: null,
          latencyMs: 182,
          lastSeenAt: LAUNCHED_AT - 26 * 60_000,
          sessions: 2,
        },
      ]
    : null;

/** The Host whose sheet opens on launch. */
export const DEV_HOST_SHEET: string | null =
  DEV_HOSTS === null ? null : launched("polarisDevHostSheet");

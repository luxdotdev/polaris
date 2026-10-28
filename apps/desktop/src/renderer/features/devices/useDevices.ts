/**
 * Settings → Devices' data: each Host's Relay route and Linked Devices, asked
 * when the page opens and again after each change it makes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { HostView } from "../../../shared/api.ts";
import { polaris } from "../bridge.ts";
import { showRefusal } from "../session/dispatch.ts";
import { CAPABILITY, type DeviceSummary, type HostRelay } from "./model.ts";

const label = (host: HostView) => ({ key: host.key, label: host.label });

const relayOf = async (host: HostView): Promise<HostRelay> => {
  if (host.status.state !== "connected")
    return { ...label(host), kind: "offline", state: host.status.state };

  if (!host.status.capabilities.includes(CAPABILITY))
    return { ...label(host), kind: "unsupported" };

  const [route, devices] = await Promise.all([
    polaris().request("relayRoute.status", { hostKey: host.key }),
    polaris().request("devices.list", { hostKey: host.key }),
  ]);

  if (!route.ok) return { ...label(host), kind: "failed", message: route.error.message };

  if (!devices.ok) return { ...label(host), kind: "failed", message: devices.error.message };

  return { ...label(host), kind: "ready", route: route.value, devices: devices.value };
};

/** A Host's line before it answers. */
const pending = (host: HostView): HostRelay =>
  host.status.state === "connected"
    ? { ...label(host), kind: "loading" }
    : { ...label(host), kind: "offline", state: host.status.state };

export const useDevices = (hosts: ReadonlyArray<HostView>) => {
  const [relays, setRelays] = useState<ReadonlyArray<HostRelay>>(() => hosts.map(pending));
  const [asked, setAsked] = useState(0);
  const latest = useRef(hosts);
  latest.current = hosts;
  // Hosts change identity on every feed item; reload only when who is connected changes.
  const roster = hosts.map((h) => `${h.key}:${h.label}:${h.status.state}`).join("|");

  useEffect(() => {
    let live = true;

    void Promise.all(latest.current.map(relayOf)).then((next) => {
      if (live) setRelays(next);
    });

    return () => {
      live = false;
    };
  }, [roster, asked]);

  const reload = useCallback(() => setAsked((n) => n + 1), []);

  /** Unlinks the device on every Host it is on; each refusal toasts. */
  const unlink = async (device: DeviceSummary) => {
    const results = await Promise.all(
      device.on.map(({ hostKey, id }) => polaris().request("devices.unlink", { hostKey, id }))
    );

    for (const result of results)
      if (!result.ok) showRefusal(`Couldn't unlink ${device.name}`, result.error);

    reload();
  };

  /** "Retry": shares the device with each Host it didn't reach. */
  const share = async (device: DeviceSummary) => {
    const results = await Promise.all(
      device.notShared.map(({ key }) =>
        polaris().request("devices.share", {
          hostKey: key,
          name: device.name,
          relayAddress: device.relayAddress,
          noiseKey: device.noiseKey,
        })
      )
    );

    for (const result of results)
      if (!result.ok) showRefusal(`Couldn't share ${device.name}`, result.error);

    reload();
  };

  return { relays, reload, unlink, share };
};

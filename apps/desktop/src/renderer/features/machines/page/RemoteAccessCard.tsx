/**
 * The host page's Remote access card (Paper HS-D; D2, D2b): one row per route the host's
 * daemon offers, the Polaris Relay and Tailscale, each off until the user turns it on. Shown
 * only for a connected host whose daemon offers a route.
 */
import { SettingsCard, SettingsWell } from "@polaris/ui";
import type { MachineView } from "../../../../shared/api.ts";
import { RelayRoute } from "../RelayRoute.tsx";
import { RemoteAccess } from "../RemoteAccess.tsx";

/** Which routes a connected host's daemon offers; empty otherwise. */
export const routesOf = (machine: MachineView) => {
  if (machine.status?.state !== "connected") return { relay: false, tailscale: false };
  const capabilities: ReadonlyArray<string> = machine.status.capabilities;

  return {
    relay: capabilities.includes("linked-devices"),
    tailscale: capabilities.includes("remote-access"),
  };
};

export const RemoteAccessCard = ({ machine }: { readonly machine: MachineView }) => {
  const { relay, tailscale } = routesOf(machine);

  if (!relay && !tailscale) return null;

  return (
    <SettingsCard
      title="Remote access"
      aside="Each route off until you turn it on"
      data-testid="remote-access-card"
    >
      <SettingsWell>
        {relay ? (
          <div className="px-4 py-3">
            <RelayRoute hostKey={machine.key} hostLabel={machine.label} />
          </div>
        ) : null}
        {tailscale ? (
          <div className="px-4 py-3">
            <RemoteAccess hostKey={machine.key} />
          </div>
        ) : null}
      </SettingsWell>
    </SettingsCard>
  );
};

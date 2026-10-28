/**
 * Settings → Devices (Paper D1, D1b; ENG-461): Linked Devices across every Host,
 * linking a new one, and which Hosts they reach through the Polaris Relay.
 */
import { Button, cn } from "@polaris/ui";
import type { HostView } from "../../../shared/api.ts";
import { useApp, useShellActions } from "../../shell/hooks.ts";
import { useNow } from "../../shell/useNow.ts";
import { sectionInfo } from "../settings/model/sections.ts";
import { Column, Group, Heading, PageHeader } from "../settings/ui/parts.tsx";
import { DeviceRow } from "./DeviceRow.tsx";
import { LinkPanel } from "./LinkPanel.tsx";
import { devicesOf, type HostRelay, relayLine, takesDevices } from "./model.ts";
import { useDevices } from "./useDevices.ts";

const Note = ({ children }: { readonly children: React.ReactNode }) => (
  <p className="bg-surface-sunken rounded-card px-panel text-body text-text-subtle py-3">
    {children}
  </p>
);

const HostRow = ({
  host,
  onTurnOn,
}: {
  readonly host: HostRelay;
  readonly onTurnOn: () => void;
}) => {
  const line = relayLine(host);

  return (
    <div className="px-panel flex h-11 items-center gap-3" data-testid="relay-host">
      <span className="text-label text-text-default min-w-0 flex-1 truncate">{host.label}</span>
      <span
        className={cn(
          "text-caption shrink-0 whitespace-nowrap",
          line.live ? "text-text-default" : "text-text-subtle"
        )}
      >
        {line.text}
      </span>
      {line.action ? (
        <Button variant="ghost" size="xs" onClick={onTurnOn}>
          Turn on
        </Button>
      ) : null}
    </div>
  );
};

/** The page for `hosts`; "Turn on" and "Open hosts" call `onOpenHosts`. */
export const Devices = ({
  hosts,
  onOpenHosts: toHosts,
}: {
  readonly hosts: ReadonlyArray<HostView>;
  readonly onOpenHosts: () => void;
}) => {
  const { relays, reload, unlink, share } = useDevices(hosts);
  const now = useNow();
  const info = sectionInfo("devices");
  const devices = devicesOf(relays);
  const labelOf = (key: string) => hosts.find((h) => h.key === key)?.label ?? key;
  const canLink = relays.some((h) => takesDevices(h) && h.route.connected);

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      <section className="flex flex-col gap-3">
        <Heading
          aside={
            <span className="text-caption text-text-subtle">
              Each one can do anything you can do here
            </span>
          }
        >
          Linked devices
        </Heading>
        {devices.length === 0 ? null : (
          <Group label="Linked devices">
            {devices.map((device) => (
              <DeviceRow
                key={device.noiseKey}
                device={device}
                now={now}
                onUnlink={() => unlink(device)}
                onRetry={() => share(device)}
              />
            ))}
          </Group>
        )}
        {canLink ? (
          <LinkPanel labelOf={labelOf} onLinked={reload} />
        ) : (
          <Note>
            Turn on the Polaris Relay for a host to link a device.{" "}
            <button type="button" className="text-text-default underline" onClick={toHosts}>
              Open hosts
            </button>
          </Note>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <Heading
          aside={
            <span className="text-caption text-text-subtle">
              Only hosts with the Polaris Relay on
            </span>
          }
        >
          Hosts your devices reach
        </Heading>
        <Group label="Hosts your devices reach">
          {relays.map((host) => (
            <HostRow key={host.key} host={host} onTurnOn={toHosts} />
          ))}
        </Group>
      </section>
    </Column>
  );
};

export const DevicesPage = () => {
  const hosts = useApp((s) => s.hosts);
  const { openSettings } = useShellActions();

  return <Devices hosts={hosts} onOpenHosts={() => openSettings("hosts")} />;
};

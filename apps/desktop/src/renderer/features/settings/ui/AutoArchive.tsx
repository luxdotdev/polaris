/**
 * Settings → Sessions → Archive: when each Host archives its dormant sessions (ENG-384). Saved
 * on the Host, which archives them on its own; shown at once, reloaded if the Host refuses.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@polaris/ui";
import { useCallback, useEffect, useState } from "react";
import type { HostView } from "../../../../shared/api.ts";
import { polaris } from "../../bridge.ts";
import { useApp } from "../../../shell/hooks.ts";
import { showRefusal } from "../../session/dispatch.ts";
import { hasCapability } from "../../session/hooks.ts";
import { SettingRow } from "./parts.tsx";

const CHOICES = [1, 3, 7, 14, 30];

const NEVER = "never";

const label = (days: number) => (days === 1 ? "After 1 day" : `After ${days} days`);

const HostAutoArchive = ({ host, named }: { readonly host: HostView; readonly named: boolean }) => {
  const connected = host.status.state === "connected";
  const [afterDays, setAfterDays] = useState<number | null | undefined>(undefined);

  const load = useCallback(async () => {
    const result = await polaris().request("sessions.autoArchive", { hostKey: host.key });

    if (result.ok) setAfterDays(result.value.afterDays);
  }, [host.key]);

  useEffect(() => {
    if (connected) void load();
  }, [connected, load]);

  const save = async (next: number | null) => {
    setAfterDays(next);

    const result = await polaris().request("sessions.setAutoArchive", {
      hostKey: host.key,
      settings: { afterDays: next },
    });

    if (!result.ok) {
      showRefusal("Couldn't save auto-archive", result.error);
      await load();
    }
  };

  const id = `auto-archive-${host.key}`;

  const choices =
    afterDays == null || CHOICES.includes(afterDays)
      ? CHOICES
      : [...CHOICES, afterDays].toSorted((a, b) => a - b);

  return (
    <SettingRow
      title={named ? `Archive dormant sessions on ${host.label}` : "Archive dormant sessions"}
      caption="After this long with no activity. Pinned sessions and sessions in a constellation are kept."
      htmlFor={id}
    >
      <Select
        value={afterDays === undefined ? "" : afterDays === null ? NEVER : String(afterDays)}
        disabled={!connected || afterDays === undefined}
        onValueChange={(value) => void save(value === NEVER ? null : Number(value))}
      >
        <SelectTrigger id={id} className="text-label h-7 w-[140px]">
          <SelectValue placeholder={connected ? "Loading…" : "Not connected"} />
        </SelectTrigger>
        <SelectContent>
          {choices.map((days) => (
            <SelectItem key={days} value={String(days)}>
              {label(days)}
            </SelectItem>
          ))}
          <SelectItem value={NEVER}>Never</SelectItem>
        </SelectContent>
      </Select>
    </SettingRow>
  );
};

export const AutoArchiveSettings = () => {
  const hosts = useApp((s) => s.hosts).filter((host) =>
    hasCapability(host, "sessions.auto-archive")
  );

  return hosts.map((host) => (
    <HostAutoArchive key={host.key} host={host} named={hosts.length > 1} />
  ));
};

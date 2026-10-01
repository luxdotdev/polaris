import { upgradeDue } from "@polaris/client/install";
import type { HostView } from "../../shared/api.ts";
import type { DaemonUpdateView } from "../../shared/daemonUpdates.ts";
import type { Settings } from "../settings.ts";

export interface UpdateFacts {
  readonly platform: string | null;
  readonly installedVersion: string | null;
  readonly bundledVersion: string | null;
  readonly epoch: number;
  readonly progress: DaemonUpdateView["progress"];
  readonly lastUpdate: DaemonUpdateView["lastUpdate"];
}

export const updatePolicy = (settings: Settings, key: string) => {
  const keepDaemonsUpToDate = settings.keepDaemonsUpToDate ?? true;

  const keepUpToDateOverride =
    key === "local"
      ? (settings.local?.keepDaemonUpToDate ?? null)
      : (settings.hosts?.find((h) => h.alias === key)?.keepDaemonUpToDate ?? null);

  return {
    keepDaemonsUpToDate,
    keepUpToDateOverride,
    keepUpToDate: keepUpToDateOverride ?? keepDaemonsUpToDate,
  };
};

export const daemonUpdateView = (
  settings: Settings,
  key: string,
  host: HostView | undefined,
  facts: UpdateFacts | undefined,
  bundledVersion: string | null,
  localManaged: boolean
): DaemonUpdateView => {
  const installedVersion =
    facts !== undefined && (host?.status.epoch ?? 0) <= facts.epoch
      ? facts.installedVersion
      : (host?.status.host?.daemonVersion ?? null);

  const bundled = bundledVersion;
  const managed = key !== "local" || localManaged;

  return {
    ...updatePolicy(settings, key),
    managed,
    installedVersion,
    bundledVersion: bundled,
    updateAvailable:
      managed &&
      installedVersion !== null &&
      bundled !== null &&
      upgradeDue(installedVersion, bundled),
    progress: facts?.progress ?? null,
    lastUpdate: facts?.lastUpdate ?? settings.daemonUpdates?.[key] ?? null,
  };
};

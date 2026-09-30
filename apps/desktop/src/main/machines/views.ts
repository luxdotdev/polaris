/**
 * Pure pieces of the machines feature: the Settings rows (`MachineView`) from
 * the settings, the Host list and each Host's install flow, and when a
 * Connection State calls for a background check.
 */
import { compareVersions, type DaemonReport } from "@polaris/client/install";
import { Predicate } from "effect";
import type { HostView, InstallFlowView, MachineView, SshAliasView } from "../../shared/api.ts";
import { LOCAL_HOST_KEY } from "../hosts.ts";
import type { Settings } from "../settings.ts";
import type { InstallOutcome, InstallSnapshot } from "./installFlow.ts";

/** A Host's install flow as `Machines` tracks it. */
export interface InstallRecord {
  readonly snapshot: InstallSnapshot;
  /** What is happening now (checking or installing), for the progress line. */
  readonly activity: string | null;
  /** The offered build's size, for the approval card. */
  readonly offerSize: number | null;
}

export const installFlowView = ({
  snapshot,
  activity,
  offerSize,
}: InstallRecord): InstallFlowView => ({
  step: snapshot.value,
  activity,
  offer:
    snapshot.context.offer === null ? null : { ...snapshot.context.offer, sizeBytes: offerSize },
  outcome: snapshot.context.outcome,
  problem: snapshot.context.problem,
});

export interface MachineViewsInput {
  readonly settings: Settings;
  readonly hosts: ReadonlyArray<HostView>;
  readonly installs: ReadonlyMap<string, InstallRecord>;
  readonly aliases: ReadonlyArray<SshAliasView>;
}

/** This Mac first (even while switched off), then the remote Hosts in settings order. */
export const machineViews = ({
  settings,
  hosts,
  installs,
  aliases,
}: MachineViewsInput): ReadonlyArray<MachineView> => {
  const status = (key: string) => hosts.find((h) => h.key === key)?.status ?? null;
  const local = hosts.find((h) => h.key === LOCAL_HOST_KEY);

  const localView: MachineView = {
    key: LOCAL_HOST_KEY,
    label: local?.label ?? "This Mac",
    colour: null,
    alias: null,
    target: null,
    enabled: settings.local?.enabled ?? true,
    forwardAgent: false,
    remoteCommand: null,
    status: status(LOCAL_HOST_KEY),
    install: null,
  };

  const remotes = (settings.hosts ?? []).map((remote): MachineView => {
    const target = aliases.find((a) => a.alias === remote.alias);
    const install = installs.get(remote.alias);

    return {
      key: remote.alias,
      label: remote.label ?? remote.alias,
      colour: remote.colour ?? null,
      alias: remote.alias,
      target: target === undefined ? null : { hostName: target.hostName, user: target.user },
      enabled: true,
      forwardAgent: remote.forwardAgent ?? false,
      remoteCommand: remote.remoteCommand ?? null,
      status: status(remote.alias),
      install: install === undefined ? null : installFlowView(install),
    };
  });

  return [localView, ...remotes];
};

/** Reasons the install flow can fix: no Daemon installed, or one too old to talk to. */
const INSTALL_REASONS: ReadonlySet<string> = new Set([
  "polaris-not-installed",
  "protocol-mismatch",
]);

/**
 * Whether this status calls for a background check, as a key that changes
 * once per occasion (so a Needs Attention retry every 2 min doesn't probe
 * again): entering Needs Attention for a reason the install flow fixes, or a
 * new connection to a Daemon older than the bundled build. Null otherwise.
 */
export const backgroundCheckKey = (
  view: HostView,
  bundledVersion: string | null
): string | null => {
  const { status } = view;

  if (view.alias === null) return null;

  if (status.state === "needs-attention" && status.failure !== null) {
    return INSTALL_REASONS.has(status.failure.reason)
      ? `${status.failure.reason}:${status.since}`
      : null;
  }

  if (status.state === "connected" && status.host !== null && bundledVersion !== null) {
    return compareVersions(status.host.daemonVersion, bundledVersion) < 0
      ? `upgrade:${status.epoch}`
      : null;
  }

  return null;
};

const LINGER_COMMAND = /sudo loginctl enable-linger \S+/;

/** What `polaris install|upgrade --json` reported, as the outcome's notes. */
export const reportOutcome = (
  report: DaemonReport,
  base: Pick<InstallOutcome, "kind" | "version" | "from">
): InstallOutcome => {
  const notes = Array.isArray(report.notes) ? report.notes.filter(Predicate.isString) : [];
  const linger = notes.map((note) => LINGER_COMMAND.exec(note)?.[0]).find(Predicate.isString);

  return {
    ...base,
    notes,
    adminCommand: report.linger === "needs-admin" ? (linger ?? null) : null,
  };
};

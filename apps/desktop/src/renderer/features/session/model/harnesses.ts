/**
 * The Harnesses a new session can start on a Host: the catalogue joined with
 * the Host's `harness.availability`. Polaris never installs a Harness; one
 * that isn't ready shows its setup line and links its docs.
 */
import {
  type Capability,
  harnessEntry,
  type HarnessStatus,
  HARNESS_CATALOGUE,
  type HostHarnesses,
  type KnownHarnessKind,
} from "@polaris/protocol";
import type { Plain } from "../../../../shared/api.ts";

export type AvailabilityReport = Plain<HostHarnesses>;

export interface HarnessOption {
  readonly kind: KnownHarnessKind;
  /** The product name, as the vendor writes it. */
  readonly name: string;
  readonly status: HarnessStatus;
  /** Ready, or the Host couldn't say: a session may start and the Daemon decides. */
  readonly startable: boolean;
  /** What to do before it can start, in one line; null when nothing is needed. */
  readonly setupLine: string | null;
  /** The Harness's own reason, when it gave one. */
  readonly detail: string | null;
  readonly docsUrl: string;
}

const STARTABLE: ReadonlySet<HarnessStatus> = new Set(["ready", "unknown"]);

/** The card's second line when the Harness can't start yet (its Model otherwise). */
export const STATUS_CAPTIONS: Readonly<Record<HarnessStatus, string | null>> = {
  ready: null,
  unknown: null,
  "not-installed": "Not installed",
  "needs-sign-in": "Needs sign-in",
  outdated: "Needs a newer version",
};

interface Probe {
  readonly status: HarnessStatus;
  readonly version: string | null;
  readonly minVersion: string;
  readonly detail: string | null;
}

const installed = (name: string, version: string | null) =>
  version === null ? name : `${name} ${version}`;

const setupLine = (kind: KnownHarnessKind, probe: Probe): string | null => {
  const entry = harnessEntry(kind);

  if (entry === undefined) return null;

  switch (probe.status) {
    case "not-installed":
      return entry.setup.install;
    case "needs-sign-in":
      return entry.setup.signIn;
    case "outdated":
      return `${installed(entry.name, probe.version)} is older than ${probe.minVersion}, the oldest Polaris supports. See its setup guide.`;
    case "ready":
    case "unknown":
      return null;
  }
};

const option = (kind: KnownHarnessKind, probe: Probe): HarnessOption | null => {
  const entry = harnessEntry(kind);

  if (entry === undefined) return null;

  return {
    kind,
    name: entry.name,
    status: probe.status,
    startable: STARTABLE.has(probe.status),
    setupLine: setupLine(kind, probe),
    detail: probe.status === "ready" ? null : probe.detail,
    docsUrl: entry.setup.docsUrl,
  };
};

const isKnown = (kind: string): kind is KnownHarnessKind =>
  HARNESS_CATALOGUE.some((entry) => entry.kind === kind);

/**
 * With a report: each Harness the Host's Daemon drives, in catalogue order (kinds this
 * build doesn't know are left out). Without one: the catalogue Harnesses whose driver the
 * Daemon announces, status unknown.
 */
export const harnessOptions = (
  report: AvailabilityReport | null,
  capabilities: ReadonlyArray<Capability>
): ReadonlyArray<HarnessOption> => {
  if (report !== null) {
    return report.harnesses.flatMap((probe) => {
      const found = isKnown(probe.harness) ? option(probe.harness, probe) : null;

      return found === null ? [] : [found];
    });
  }

  return HARNESS_CATALOGUE.filter((entry) => capabilities.includes(entry.capability)).flatMap(
    (entry) => {
      const found = option(entry.kind, {
        status: "unknown",
        version: null,
        minVersion: entry.minVersion,
        detail: null,
      });

      return found === null ? [] : [found];
    }
  );
};

/** The Harness a new session starts on by default: the first that can start. */
export const defaultHarness = (options: ReadonlyArray<HarnessOption>): KnownHarnessKind | null =>
  (options.find((o) => o.startable) ?? options[0])?.kind ?? null;

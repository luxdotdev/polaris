/**
 * The Harnesses a Host can run: the catalogue joined with the Host's
 * availability. Polaris never installs a Harness; one that isn't ready says
 * why, with its setup line, its docs, and (when it only needs signing in) its
 * own sign-in to run in a terminal. Kinds this build doesn't know show neutral.
 */
import {
  type Capability,
  harnessEntry,
  type HarnessKind,
  type HarnessStatus,
  HARNESS_CATALOGUE,
  type HostHarnesses,
} from "@polaris/protocol";
import type { Plain } from "../../../../shared/api.ts";

export type AvailabilityReport = Plain<HostHarnesses>;

export interface HarnessOption {
  readonly kind: HarnessKind;
  /** The product name as the vendor writes it; an unknown kind shows its kind. */
  readonly name: string;
  readonly status: HarnessStatus;
  /** Ready, or the Host couldn't say: a session may start and the Daemon decides. */
  readonly startable: boolean;
  /**
   * Offered in the pickers: ready or only needing sign-in (Polaris supports what the user
   * already has). The rest live in the availability view, with their setup line and docs.
   */
  readonly listed: boolean;
  readonly version: string | null;
  /** The oldest version its driver supports. */
  readonly minVersion: string;
  /** What to do before it can start, in one line; null when nothing is needed. */
  readonly setupLine: string | null;
  /** The Harness's own reason, when it gave one. */
  readonly detail: string | null;
  /** Its setup guide; null for a kind this build's catalogue doesn't list. */
  readonly docsUrl: string | null;
  /** How it's signed in ("Claude Max", "ChatGPT"), when it says; null otherwise. */
  readonly signInKind: string | null;
  /** Its own sign-in, to run in a terminal on the Host; null unless it needs signing in. */
  readonly signInArgv: ReadonlyArray<string> | null;
  /** "older than tested (2.1.283)" for a usable version below the tested one; null otherwise. */
  readonly note: string | null;
}

const STARTABLE: ReadonlySet<HarnessStatus> = new Set(["ready", "unknown"]);

const LISTED: ReadonlySet<HarnessStatus> = new Set(["ready", "needs-sign-in"]);

/** A Harness's status in words (rule/glossary-lowercase); neutral, never a signal colour. */
export const STATUS_LABELS: Readonly<Record<HarnessStatus, string>> = {
  ready: "Ready",
  unknown: "Status unknown",
  "not-installed": "Not installed",
  "needs-sign-in": "Needs sign-in",
  outdated: "Needs a newer version",
};

/**
 * The quiet caption for a version between the minimum and the tested one (DESIGN.md, Settings S1):
 * never a signal colour and never an action.
 */
export const olderThanTestedNote = (tested: string | null | undefined): string | null =>
  tested === null || tested === undefined ? null : `older than tested (${tested})`;

interface Probe {
  readonly harness: HarnessKind;
  readonly status: HarnessStatus;
  readonly version: string | null;
  readonly minVersion: string;
  readonly olderThanTested: string | null;
  readonly detail: string | null;
  readonly signInArgv: ReadonlyArray<string> | null;
  readonly signInKind?: string | null;
}

const installed = (name: string, version: string | null) =>
  version === null ? name : `${name} ${version}`;

const setupLine = (probe: Probe): string | null => {
  const entry = harnessEntry(probe.harness);
  const name = entry?.name ?? probe.harness;

  switch (probe.status) {
    case "not-installed":
      return entry?.setup.install ?? `${name} isn't installed on this host.`;
    case "needs-sign-in":
      return entry?.setup.signIn ?? `Sign in to ${name} in its own terminal.`;
    case "outdated":
      return `${installed(name, probe.version)} is older than ${probe.minVersion}, the oldest Polaris supports. See its setup guide.`;
    case "ready":
    case "unknown":
      return null;
  }
};

const option = (probe: Probe, listed = LISTED.has(probe.status)): HarnessOption => {
  const entry = harnessEntry(probe.harness);

  return {
    kind: probe.harness,
    name: entry?.name ?? probe.harness,
    status: probe.status,
    startable: STARTABLE.has(probe.status),
    listed,
    version: probe.version,
    minVersion: probe.minVersion,
    setupLine: setupLine(probe),
    detail: probe.status === "ready" ? null : probe.detail,
    docsUrl: entry?.setup.docsUrl ?? null,
    signInArgv: probe.status === "needs-sign-in" ? probe.signInArgv : null,
    signInKind: probe.status === "ready" ? (probe.signInKind ?? null) : null,
    note: olderThanTestedNote(probe.olderThanTested),
  };
};

/**
 * With a report: each Harness the Host's Daemon drives, in its order (unknown kinds
 * included, shown neutral). Without one: the catalogue Harnesses whose driver the Daemon
 * announces, status unknown and listed.
 */
export const harnessOptions = (
  report: AvailabilityReport | null,
  capabilities: ReadonlyArray<Capability>
): ReadonlyArray<HarnessOption> => {
  if (report !== null) return report.harnesses.map((probe) => option(probe));

  // An older Daemon can't report availability: offer its drivers rather than nothing.
  return HARNESS_CATALOGUE.filter((entry) => capabilities.includes(entry.capability)).map((entry) =>
    option(
      {
        harness: entry.kind,
        status: "unknown",
        version: null,
        minVersion: entry.minVersion,
        olderThanTested: null,
        detail: null,
        signInArgv: null,
      },
      true
    )
  );
};

/** What the pickers show: the listed Harnesses. */
export const listedOptions = (options: ReadonlyArray<HarnessOption>) =>
  options.filter((o) => o.listed);

/** How many Harnesses don't have a card, for the "Other harnesses" link. */
export const otherCount = (
  options: ReadonlyArray<HarnessOption>,
  shown: ReadonlyArray<HarnessOption> = listedOptions(options)
) => options.length - shown.length;

/** When each Harness last ran a session on the Host (ISO time), for ordering the cards. */
export type LastUsed = ReadonlyMap<HarnessKind, string>;

const NEVER: LastUsed = new Map();

/** Ready ones first, most recently used first; then the rest, in the Host's order. */
const byUse = (options: ReadonlyArray<HarnessOption>, lastUsed: LastUsed) =>
  options
    .map((option, order) => ({ option, order }))
    .toSorted((a, b) => {
      const ready = Number(b.option.status === "ready") - Number(a.option.status === "ready");

      const used = (lastUsed.get(b.option.kind) ?? "").localeCompare(
        lastUsed.get(a.option.kind) ?? ""
      );

      return ready !== 0 ? ready : used !== 0 ? used : a.order - b.order;
    })
    .map(({ option }) => option);

/** The Harness a new session starts on by default: the most recently used ready one, never one that isn't. */
export const defaultHarness = (
  options: ReadonlyArray<HarnessOption>,
  lastUsed: LastUsed = NEVER
): HarnessKind | null => byUse(options, lastUsed).find((o) => o.status === "ready")?.kind ?? null;

/** Cards on the new-session page (DESIGN.md: one row); the rest wait behind "Other harnesses". */
export const MAX_HARNESS_CARDS = 3;

/**
 * The listed Harnesses that get a card: the most recently used ready ones first, up to three,
 * always including the chosen one.
 */
export const cardOptions = (
  options: ReadonlyArray<HarnessOption>,
  lastUsed: LastUsed,
  chosen: HarnessKind | null
): ReadonlyArray<HarnessOption> => {
  const ordered = byUse(listedOptions(options), lastUsed);
  const shown = ordered.slice(0, MAX_HARNESS_CARDS);
  const picked = ordered.find((o) => o.kind === chosen);

  if (picked === undefined || shown.includes(picked)) return shown;

  return [...shown.slice(0, MAX_HARNESS_CARDS - 1), picked];
};

/** Nothing on the Host can start a session now (its report is in, and none is ready). */
export const noneReady = (options: ReadonlyArray<HarnessOption>) =>
  !options.some((o) => o.status === "ready");

/** Why a Harness can't start, in one line: "Claude Code 2.0.9 · needs 2.1.0 or newer". */
export const reasonLine = (option: HarnessOption): string => {
  const named = option.version === null ? option.name : `${option.name} ${option.version}`;

  switch (option.status) {
    case "outdated":
      return `${named} · needs ${option.minVersion} or newer`;
    case "not-installed":
      return `${option.name} · not installed`;
    case "needs-sign-in":
      return `${named} · needs sign-in`;
    case "unknown":
      return `${named} · couldn't check`;
    case "ready":
      return `${named} · ready`;
  }
};

/** "Ready on 2 of 3 hosts" (DESIGN.md, Settings S1), over one Harness's options per Host. */
export const readyOn = (perHost: ReadonlyArray<HarnessOption | undefined>): string => {
  const ready = perHost.filter((o) => o?.status === "ready").length;

  return `Ready on ${ready} of ${perHost.length} ${perHost.length === 1 ? "host" : "hosts"}`;
};

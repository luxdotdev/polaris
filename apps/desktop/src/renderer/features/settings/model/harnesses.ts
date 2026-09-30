/**
 * Settings → Harnesses as data (DESIGN.md, Settings; Paper S1): one group per
 * catalogue Harness, one row per Host with its version, availability and at
 * most one action. Polaris never installs a Harness: a missing or outdated one
 * links its setup guide, and sign-in runs the Harness's own command.
 */
import { HARNESS_CATALOGUE, type HarnessStatus, type HostHarnesses } from "@polaris/protocol";
import type { Plain } from "../../../../shared/api.ts";

export type AvailabilityReport = Plain<HostHarnesses>;

/** What Settings knows of one Host's Harnesses. */
export type HostProbe =
  | { readonly kind: "checking" }
  | { readonly kind: "offline" }
  /** Its Daemon predates `harness.availability`. */
  | { readonly kind: "unsupported" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "reported"; readonly report: AvailabilityReport };

export interface ProbedHost {
  readonly hostKey: string;
  readonly label: string;
  readonly probe: HostProbe;
}

export type RowAction =
  | { readonly kind: "sign-in"; readonly argv: ReadonlyArray<string> }
  | { readonly kind: "setup-guide"; readonly url: string };

/** The availability lane: a neutral glyph and its words (never a signal colour). */
export type RowGlyph = "ready" | "sign-in" | "update" | "missing" | "unknown";

export interface HostRow {
  readonly hostKey: string;
  readonly hostLabel: string;
  /** Mono in the version lane; null shows a dash. */
  readonly version: string | null;
  readonly glyph: RowGlyph;
  readonly text: string;
  readonly ready: boolean;
  readonly action: RowAction | null;
}

export interface HarnessGroup {
  readonly kind: string;
  readonly name: string;
  /** How Polaris drives it, in one caption line. */
  readonly caption: string;
  readonly rows: ReadonlyArray<HostRow>;
  readonly ready: number;
  /** "Ready on 2 of 4 hosts", "Ready on all 4 hosts · 0.61.0", "Not on any host yet". */
  readonly summary: string;
  /** Ready everywhere: the group collapses to its header. */
  readonly collapsible: boolean;
}

const HOW_DRIVEN = new Map([
  ["claude", "Driven through the Agent SDK · hands off to its terminal one at a time"],
  ["codex", "Driven through one shared app-server · co-attaches live in its terminal"],
  ["opencode", "Driven through opencode serve · any provider you sign in to"],
  ["gemini", "Driven through the Agent Client Protocol"],
  ["copilot", "Driven through the Agent Client Protocol"],
]);

const NOT_REPORTED: Readonly<Record<Exclude<HostProbe["kind"], "reported">, string>> = {
  checking: "Checking…",
  offline: "Host not connected",
  unsupported: "This host's daemon can't report harnesses",
  failed: "Couldn't check",
};

interface Entry {
  readonly kind: string;
  readonly docsUrl: string;
}

const STATUS_ROW: Readonly<
  Record<
    HarnessStatus,
    (
      entry: Entry,
      found: { minVersion: string; signInArgv: ReadonlyArray<string> | null }
    ) => Omit<HostRow, "hostKey" | "hostLabel" | "version">
  >
> = {
  ready: () => ({ glyph: "ready", text: "Ready", ready: true, action: null }),
  "needs-sign-in": (_entry, found) => ({
    glyph: "sign-in",
    text: "Needs sign-in",
    ready: false,
    action: found.signInArgv === null ? null : { kind: "sign-in", argv: found.signInArgv },
  }),
  outdated: (entry, found) => ({
    glyph: "update",
    text: `Needs ${found.minVersion} or later`,
    ready: false,
    action: { kind: "setup-guide", url: entry.docsUrl },
  }),
  "not-installed": (entry) => ({
    glyph: "missing",
    text: "Not installed",
    ready: false,
    action: { kind: "setup-guide", url: entry.docsUrl },
  }),
  unknown: () => ({ glyph: "unknown", text: "Couldn't tell", ready: false, action: null }),
};

const hostRow = (entry: Entry, host: ProbedHost): HostRow => {
  const base = { hostKey: host.hostKey, hostLabel: host.label };

  if (host.probe.kind !== "reported") {
    return {
      ...base,
      version: null,
      glyph: "unknown",
      text: host.probe.kind === "failed" ? host.probe.message : NOT_REPORTED[host.probe.kind],
      ready: false,
      action: null,
    };
  }

  const found = host.probe.report.harnesses.find((h) => h.harness === entry.kind);

  if (found === undefined) {
    return {
      ...base,
      version: null,
      glyph: "unknown",
      text: "This host's daemon doesn't drive it",
      ready: false,
      action: null,
    };
  }

  return { ...base, version: found.version, ...STATUS_ROW[found.status](entry, found) };
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The one version every Host runs, or null when they differ. */
const sharedVersion = (rows: ReadonlyArray<HostRow>): string | null => {
  const versions = new Set(rows.map((r) => r.version));

  return versions.size === 1 ? (rows[0]?.version ?? null) : null;
};

const summary = (rows: ReadonlyArray<HostRow>, ready: number): string => {
  if (rows.length === 0) return "No hosts yet";

  if (ready === 0) return "Not ready on any host yet";

  if (ready < rows.length) return `Ready on ${ready} of ${plural(rows.length, "host")}`;
  const version = sharedVersion(rows);
  const all = rows.length === 1 ? "Ready on its host" : `Ready on all ${rows.length} hosts`;

  return version === null ? all : `${all} · ${version}`;
};

/** Every catalogue Harness, in catalogue order, across the given Hosts. */
export const harnessGroups = (hosts: ReadonlyArray<ProbedHost>): ReadonlyArray<HarnessGroup> =>
  HARNESS_CATALOGUE.map((entry) => {
    const rows = hosts.map((host) =>
      hostRow({ kind: entry.kind, docsUrl: entry.setup.docsUrl }, host)
    );

    const ready = rows.filter((r) => r.ready).length;

    return {
      kind: entry.kind,
      name: entry.name,
      caption: HOW_DRIVEN.get(entry.kind) ?? "",
      rows,
      ready,
      summary: summary(rows, ready),
      collapsible: rows.length > 0 && ready === rows.length,
    };
  });

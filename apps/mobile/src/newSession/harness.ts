/**
 * The Desktop App's new-session Harness rules on the phone (DESIGN.md, New session and Harness
 * picker): which Harnesses are offered, which one is chosen first, and the Models' shortlist.
 */
import {
  type HarnessAvailability,
  harnessEntry,
  type HarnessKind,
  type HarnessStatus,
  type HostHarnesses,
  type Model,
} from "@polaris/protocol";
import { Match } from "effect";

export interface HarnessOption {
  readonly kind: HarnessKind;
  readonly name: string;
  readonly status: HarnessStatus;
  /** Ready, or the Host couldn't say: a session may start and the Daemon decides. */
  readonly startable: boolean;
}

const STARTABLE: ReadonlySet<HarnessStatus> = new Set(["ready", "unknown"]);

const LISTED: ReadonlySet<HarnessStatus> = new Set(["ready", "needs-sign-in"]);

/** The Harnesses the sheet offers: ready or only needing sign-in, in the Host's order. */
export const harnessOptions = (report: HostHarnesses): ReadonlyArray<HarnessOption> =>
  report.harnesses
    .filter((h) => LISTED.has(h.status))
    .map((h) => ({
      kind: h.harness,
      name: harnessEntry(h.harness)?.name ?? h.harness,
      status: h.status,
      startable: STARTABLE.has(h.status),
    }));

/** A Harness that can't start a session yet: why, and what to do on the Host. */
export interface NotReadyHarness {
  readonly kind: HarnessKind;
  /** "Claude Code 2.0.9 · needs 2.1.0 or newer". */
  readonly reason: string;
  /** The fix, done on the Host: Polaris never signs in or installs from the phone (ADR 0001). */
  readonly remedy: string;
  /** Its setup guide, for a Harness that is missing or too old; null otherwise. */
  readonly docsUrl: string | null;
}

const named = (h: HarnessAvailability, name: string) =>
  h.version === null ? name : `${name} ${h.version}`;

const reasonOf = (h: HarnessAvailability, name: string): string =>
  Match.value(h.status).pipe(
    Match.when("outdated", () => `${named(h, name)} · needs ${h.minVersion} or newer`),
    Match.when("not-installed", () => `${name} · not installed`),
    Match.when("needs-sign-in", () => `${named(h, name)} · needs sign-in`),
    Match.when("unknown", () => `${named(h, name)} · couldn't check`),
    Match.when("ready", () => `${named(h, name)} · ready`),
    Match.exhaustive
  );

const remedyOf = (h: HarnessAvailability, name: string, hostName: string): string =>
  Match.value(h.status).pipe(
    Match.when("needs-sign-in", () =>
      h.signInArgv === null
        ? `Sign in to ${name} in a terminal on ${hostName}.`
        : `Run ${h.signInArgv.join(" ")} in a terminal on ${hostName}.`
    ),
    Match.when("not-installed", () => `Install ${name} on ${hostName}, then check again.`),
    Match.when("outdated", () => `Update ${name} on ${hostName}, then check again.`),
    Match.orElse(() => "Check again in a moment.")
  );

/**
 * Every Harness the Host reports that isn't ready, with its reason and its fix on the Host
 * (DESIGN.md, New session: with none ready, each Harness says why). Missing ones included.
 */
export const notReadyHarnesses = (
  report: HostHarnesses,
  hostName: string
): ReadonlyArray<NotReadyHarness> =>
  report.harnesses
    .filter((h) => h.status !== "ready")
    .map((h) => {
      const entry = harnessEntry(h.harness);
      const name = entry?.name ?? h.harness;
      const guide = h.status === "not-installed" || h.status === "outdated";

      return {
        kind: h.harness,
        reason: reasonOf(h, name),
        remedy: remedyOf(h, name, hostName),
        docsUrl: guide ? (entry?.setup.docsUrl ?? null) : null,
      };
    });

/** When each Harness last ran a session on the Host (its newest session's last update). */
export type LastUsed = ReadonlyMap<string, string>;

/** The Harness a new session starts on: the most recently used ready one, never one that isn't. */
export const defaultHarness = (
  options: ReadonlyArray<HarnessOption>,
  lastUsed: LastUsed
): HarnessKind | null => {
  const ready = options.filter((o) => o.status === "ready");
  const used = (o: HarnessOption) => lastUsed.get(o.kind) ?? "";

  const newest = ready.reduce<HarnessOption | null>(
    (best, o) => (best === null || used(o) > used(best) ? o : best),
    null
  );

  return newest?.kind ?? null;
};

/** The `@claude` handle the Harness chip shows. */
export const handleOf = (kind: HarnessKind): string => `@${kind}`;

/** How many Models the picker shows before "More models". */
export const SHORTLIST = 4;

const CLAUDE_DEFAULT_ROW = "default";

interface Lineage {
  readonly family: string;
  readonly version: ReadonlyArray<number> | null;
}

const lineage = (name: string): Lineage => {
  const match = /\d+(?:\.\d+)*/.exec(name);

  const family = name
    .replace(match?.[0] ?? "", " ")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();

  return { family, version: match === null ? null : match[0].split(".").map(Number) };
};

const newer = (a: ReadonlyArray<number> | null, b: ReadonlyArray<number> | null): boolean => {
  if (a === null || b === null) return a !== null && b === null;

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);

    if (d !== 0) return d > 0;
  }

  return false;
};

const superseded = (lines: ReadonlyArray<Lineage>, i: number): boolean => {
  const self = lines[i];

  return lines.some(
    (other, j) =>
      j !== i &&
      self !== undefined &&
      other.family === self.family &&
      (newer(other.version, self.version) ||
        (j < i && !newer(self.version, other.version) && !newer(other.version, self.version)))
  );
};

export interface Shortlist {
  /** The newest Model of each family, in the Harness's order, at most SHORTLIST. */
  readonly top: ReadonlyArray<Model>;
  /** Everything else the Harness lists, in its order. */
  readonly more: ReadonlyArray<Model>;
}

/**
 * Models a newer one of their family supersedes move to "More models"; the first four left are
 * shown, always with the Harness's default. Claude Code's `default` row is never offered.
 */
export const shortlist = (harness: HarnessKind, models: ReadonlyArray<Model>): Shortlist => {
  const pickable =
    harness === "claude" ? models.filter((m) => m.id !== CLAUDE_DEFAULT_ROW) : models;

  const lines = pickable.map((m) => lineage(m.name));
  const top = pickable.filter((_, i) => !superseded(lines, i)).slice(0, SHORTLIST);
  const fallback = pickable.find((m) => m.isDefault);

  if (fallback !== undefined && !top.includes(fallback)) top.splice(SHORTLIST - 1, 1, fallback);

  return { top, more: pickable.filter((m) => !top.includes(m)) };
};

/** The chip's Model name while none is picked: the Harness's default, or "Default". */
export const modelLabel = (
  harness: HarnessKind,
  models: ReadonlyArray<Model>,
  picked: Model | null
): string =>
  picked?.name ?? shortlist(harness, models).top.find((m) => m.isDefault)?.name ?? "Default";

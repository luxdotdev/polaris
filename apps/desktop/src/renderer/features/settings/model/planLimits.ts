/**
 * Plan Limits for Settings → Usage (DESIGN.md, Settings): one row per Harness
 * with its plan, freshness, and each window as a 40-cell meter. Near a limit
 * the words change, never the colour.
 */
import { harnessEntry, type PlanLimit } from "@polaris/protocol";
import { limitAge } from "../../harness/model/limits.ts";
import type { Plain } from "../../../../shared/api.ts";

export type Limit = Plain<PlanLimit>;

export const METER_CELLS = 40;

export interface LimitWindow {
  readonly key: string;
  /** "5-hour window", "Weekly", "Weekly · Opus". */
  readonly label: string;
  /** "62%", or null when the Harness reported only a status. */
  readonly percent: string | null;
  readonly litCells: number;
  /** "Resets in 1h 48m", "Near the limit · resets Thu 09:00", "Limit reached". */
  readonly note: string;
}

export interface LimitRow {
  readonly harness: string;
  readonly name: string;
  /** "Max · live" while a session runs, else "Pro · as of 40m ago" / "as of 13:01". */
  readonly caption: string;
  readonly windows: ReadonlyArray<LimitWindow>;
}

const KIND_LABELS = new Map([
  ["five-hour", "5-hour window"],
  ["weekly", "Weekly"],
]);

const KIND_ORDER = ["five-hour", "weekly"];

const kindRank = (kind: string) => {
  const i = KIND_ORDER.indexOf(kind);

  return i === -1 ? KIND_ORDER.length : i;
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const windowLabel = (limit: Limit) => {
  const kind = KIND_LABELS.get(limit.kind) ?? capitalize(limit.kind.replace(/-/g, " "));

  return limit.scope === null ? kind : `${kind} · ${limit.scope}`;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

/** "in 1h 48m" within a day, else "Thu 09:00" (local time). */
export const resetPhrase = (resetsAt: string, now: number): string => {
  const at = Date.parse(resetsAt);
  const ms = at - now;

  if (ms <= 0) return "now";

  if (ms < 86_400_000) {
    const minutes = Math.ceil(ms / 60_000);
    const h = Math.floor(minutes / 60);

    return h === 0 ? `in ${minutes}m` : `in ${h}h ${pad(minutes % 60)}m`;
  }

  const d = new Date(at);

  return `${DAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const STATUS_WORDS: Readonly<Record<Limit["status"], string | null>> = {
  ok: null,
  warning: "Near the limit",
  reached: "Limit reached",
};

const note = (limit: Limit, now: number): string => {
  const words = STATUS_WORDS[limit.status];
  const reset = limit.resetsAt === null ? null : `resets ${resetPhrase(limit.resetsAt, now)}`;

  if (words === null) return reset === null ? "" : capitalize(reset);

  return reset === null ? words : `${words} · ${reset}`;
};

/** A status-only reading lights the whole meter when reached, none otherwise. */
const litCells = (used: number | null, status: Limit["status"]) => {
  if (used !== null) return Math.round((used / 100) * METER_CELLS);

  return status === "reached" ? METER_CELLS : 0;
};

const limitWindow = (limit: Limit, now: number): LimitWindow => {
  const used = limit.usedPercent === null ? null : Math.min(100, Math.max(0, limit.usedPercent));

  return {
    key: `${limit.kind}\u0000${limit.scope ?? ""}`,
    label: windowLabel(limit),
    percent: used === null ? null : `${Math.round(used)}%`,
    litCells: litCells(used, limit.status),
    note: note(limit, now),
  };
};

/** Keeps the newest reading per (`harness`, `kind`, `scope`): each Host may report the same plan. */
export const latestLimits = (limits: ReadonlyArray<Limit>): ReadonlyArray<Limit> => {
  const newest = new Map<string, Limit>();

  for (const l of limits) {
    const key = `${l.harness}\u0000${l.kind}\u0000${l.scope ?? ""}`;
    const seen = newest.get(key);

    if (seen === undefined || seen.observedAt < l.observedAt) newest.set(key, l);
  }

  return [...newest.values()];
};

/** `running`: Harnesses with a session running now; only their fresh values read "live". */
export const limitRows = (
  limits: ReadonlyArray<Limit>,
  now: number,
  running: ReadonlySet<string>
): ReadonlyArray<LimitRow> => {
  const byHarness = new Map<string, Array<Limit>>();

  for (const l of latestLimits(limits))
    byHarness.set(l.harness, [...(byHarness.get(l.harness) ?? []), l]);

  return [...byHarness.entries()].map(([harness, list]) => {
    const sorted = [...list].sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
    const observed = list.reduce((a, b) => (a > b.observedAt ? a : b.observedAt), "");
    const plan = list.find((l) => l.plan !== null)?.plan ?? null;
    const fresh = limitAge(Date.parse(observed), now, running.has(harness));

    return {
      harness,
      name: harnessEntry(harness)?.name ?? harness,
      caption: plan === null ? capitalize(fresh) : `${capitalize(plan)} · ${fresh}`,
      windows: sorted.map((l) => limitWindow(l, now)),
    };
  });
};

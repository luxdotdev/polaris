/**
 * A Harness's Plan Limits as the picker shows them (DESIGN.md, Usage S2): what
 * each window has left and when it resets, and how fresh the numbers are. Near
 * a limit the words change, never the colour.
 */
import type { HarnessKind, PlanLimit } from "@polaris/protocol";
import { Match } from "effect";
import type { Plain } from "../../../../shared/api.ts";

export type LimitData = Plain<PlanLimit>;

const WINDOW_NAMES = new Map([
  ["five-hour", "5-hour"],
  ["weekly", "Weekly"],
]);

const ORDER = ["five-hour", "weekly"];

/** While a session of the Harness runs, values fresher than this read "live". */
const LIVE_MS = 5 * 60_000;

const windowName = (limit: LimitData) => {
  const base = WINDOW_NAMES.get(limit.kind) ?? limit.kind;

  return limit.scope === null ? base : `${base} (${limit.scope})`;
};

const rank = (limit: LimitData) => {
  const at = ORDER.indexOf(limit.kind);

  return (at === -1 ? ORDER.length : at) * 2 + (limit.scope === null ? 0 : 1);
};

/** One Harness's windows, whole-plan first, five-hour before weekly. */
export const limitsFor = (limits: ReadonlyArray<LimitData>, harness: HarnessKind) =>
  limits.filter((l) => l.harness === harness).toSorted((a, b) => rank(a) - rank(b));

/** "3m", "40m", "2h", "3d". */
export const shortDuration = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60_000));

  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);

  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

/** The share of a window still left, 0–100, from the share used (clamped). */
export const remaining = (usedPercent: number) => 100 - Math.min(100, Math.max(0, usedPercent));

/**
 * "84% left". Rounded down, so it never promises more than there is; a sliver
 * reads "<1% left" rather than "0% left", which means the limit.
 */
export const leftPhrase = (usedPercent: number): string => {
  const left = remaining(usedPercent);

  return left > 0 && left < 1 ? "<1% left" : `${Math.floor(left)}% left`;
};

/**
 * How many of `cells` stay filled: rounded, but any share left keeps one cell
 * and any share used empties one, so the meter agrees with the words at the edges.
 */
export const leftCells = (usedPercent: number, cells: number): number => {
  const left = remaining(usedPercent);
  const filled = Math.round((left / 100) * cells);

  if (left > 0 && left < 100) return Math.min(cells - 1, Math.max(1, filled));

  return filled;
};

const left = (limit: LimitData) =>
  limit.usedPercent === null ? null : leftPhrase(limit.usedPercent);

/** "5-hour 58% left · resets in 2h", "Near the weekly limit · 9% left", "5-hour limit reached · resets in 40m". */
export const limitLine = (limit: LimitData, now: number): string => {
  const name = windowName(limit);
  const percent = left(limit);

  const reset =
    limit.resetsAt === null ? null : `resets in ${shortDuration(Date.parse(limit.resetsAt) - now)}`;

  const parts: ReadonlyArray<string | null> = Match.value(limit.status).pipe(
    Match.when("reached", () => [`${name} limit reached`, reset]),
    Match.when("warning", () => [`Near the ${name.toLowerCase()} limit`, percent, reset]),
    Match.orElse(() => [percent === null ? name : `${name} ${percent}`, reset])
  );

  return parts.filter((p) => p !== null).join(" · ");
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A Plan Limit value's age (ENG-206, "the last known value with its age"): "live" only while
 * a session of its Harness runs to refresh it and the value is fresh; else "as of 40m ago"
 * within the hour, "as of 13:01" within the day (local time), "as of 2d ago" beyond.
 */
export const limitAge = (observedAt: number, now: number, running: boolean): string => {
  const age = Math.max(0, now - observedAt);

  if (running && age < LIVE_MS) return "live";

  if (age < 3_600_000) return `as of ${Math.max(1, Math.round(age / 60_000))}m ago`;

  if (age < 86_400_000) {
    const at = new Date(observedAt);

    return `as of ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }

  return `as of ${shortDuration(age)} ago`;
};

/** The newest window's age; `running`: a session of the Harness is running on the Host. */
export const freshness = (
  limits: ReadonlyArray<LimitData>,
  now: number,
  running: boolean
): string | null => {
  const newest = Math.max(...limits.map((l) => Date.parse(l.observedAt)));

  return Number.isFinite(newest) ? limitAge(newest, now, running) : null;
};

/** Every window's line plus the freshness, for the picker's hint row. */
export const limitHint = (
  limits: ReadonlyArray<LimitData>,
  now: number,
  running: boolean
): string | null => {
  if (limits.length === 0) return null;
  const lines = limits.map((l) => limitLine(l, now));
  const fresh = freshness(limits, now, running);

  return [...lines, fresh].filter((p) => p !== null).join(" · ");
};

/** Replaces the window with the same key (harness, kind, scope) with its latest value. */
export const upsertLimit = (limits: ReadonlyArray<LimitData>, next: LimitData) => [
  ...limits.filter(
    (l) => !(l.harness === next.harness && l.kind === next.kind && l.scope === next.scope)
  ),
  next,
];

/**
 * A Harness's Plan Limits as the picker shows them (DESIGN.md, Usage S2): each
 * window's use and reset, and how fresh the numbers are. Near a limit the
 * words change, never the colour.
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

/** Values older than this read "as of …"; fresher ones read "live". */
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

const used = (limit: LimitData) =>
  limit.usedPercent === null ? null : `${Math.round(limit.usedPercent)}%`;

/** "5-hour 42% · resets in 2h", "Near the weekly limit · 91%", "5-hour limit reached · resets in 40m". */
export const limitLine = (limit: LimitData, now: number): string => {
  const name = windowName(limit);
  const percent = used(limit);

  const reset =
    limit.resetsAt === null ? null : `resets in ${shortDuration(Date.parse(limit.resetsAt) - now)}`;

  const parts: ReadonlyArray<string | null> = Match.value(limit.status).pipe(
    Match.when("reached", () => [`${name} limit reached`, reset]),
    Match.when("warning", () => [`Near the ${name.toLowerCase()} limit`, percent, reset]),
    Match.orElse(() => [percent === null ? name : `${name} ${percent}`, reset])
  );

  return parts.filter((p) => p !== null).join(" · ");
};

/** "live" while fresh, else "as of 40m ago" (the newest window's age). */
export const freshness = (limits: ReadonlyArray<LimitData>, now: number): string | null => {
  const newest = Math.max(...limits.map((l) => Date.parse(l.observedAt)));

  if (!Number.isFinite(newest)) return null;
  const age = now - newest;

  return age < LIVE_MS ? "live" : `as of ${shortDuration(age)} ago`;
};

/** Every window's line plus the freshness, for the picker's hint row. */
export const limitHint = (limits: ReadonlyArray<LimitData>, now: number): string | null => {
  if (limits.length === 0) return null;
  const lines = limits.map((l) => limitLine(l, now));
  const fresh = freshness(limits, now);

  return [...lines, fresh].filter((p) => p !== null).join(" · ");
};

/** Replaces the window with the same key (harness, kind, scope) with its latest value. */
export const upsertLimit = (limits: ReadonlyArray<LimitData>, next: LimitData) => [
  ...limits.filter(
    (l) => !(l.harness === next.harness && l.kind === next.kind && l.scope === next.scope)
  ),
  next,
];

// Portions adapted from steipete/CodexBar@2ef5bb6 (MIT): the pace and projection maths and
// wording (Sources/CodexBarCore/UsagePace.swift, Sources/CodexBar/UsagePaceText.swift).
/**
 * A Plan Limit window's forecast (DESIGN.md, Usage S2): where usage would be if
 * spent evenly across the window (the pace), how far ahead or behind that it
 * is, and whether, at the rate since the window opened, it lasts until the
 * reset. Words change near a limit, never the colour.
 */
import type { LimitData } from "./limits.ts";

const MINUTE_MS = 60_000;

const HOUR_MS = 60 * MINUTE_MS;

const DAY_MS = 24 * HOUR_MS;

/** Window lengths when the Harness doesn't say. */
const DEFAULT_MINUTES = new Map([
  ["five-hour", 300],
  ["weekly", 10_080],
]);

/** A reset this far past the window's length is still the same window (clock skew). */
const RESET_TOLERANCE_MS = 2 * MINUTE_MS;

/** Before this share of the window has passed, a projection is noise: pace only. */
export const MIN_ELAPSED_SHARE = 0.05;

/** Within this many points of the pace, it reads "On pace". */
const ON_PACE = 2;

export interface Forecast {
  /** Where usage would be if spent evenly: the pace marker, 0–100 used. */
  readonly expectedUsed: number;
  /** Used minus expected: negative is in reserve, positive in deficit. */
  readonly delta: number;
  /** Milliseconds until it runs out at the window's rate; null when it lasts or can't say yet. */
  readonly runsOutInMs: number | null;
  readonly lastsUntilReset: boolean;
  /** Weekly only: full 5-hour windows of it left, at the typical use of one (Daemon history). */
  readonly sessionsLeft: number | null;
  /** Weekly only: 5-hour windows that start before it resets. */
  readonly windowsUntilReset: number | null;
}

const projection = (used: number, elapsed: number, untilReset: number, duration: number) => {
  if (elapsed < duration * MIN_ELAPSED_SHARE) return { runsOutInMs: null, lastsUntilReset: false };

  if (used <= 0) return { runsOutInMs: null, lastsUntilReset: true };
  const runsOut = ((100 - used) * elapsed) / used;

  return runsOut >= untilReset
    ? { runsOutInMs: null, lastsUntilReset: true }
    : { runsOutInMs: runsOut, lastsUntilReset: false };
};

const sessionsOf = (limit: LimitData, used: number, untilReset: number, fiveHour: boolean) => {
  const perSession = limit.weeklyPerSession;

  if (limit.kind !== "weekly" || limit.scope !== null || !fiveHour) return null;

  if (perSession === null || !(perSession > 0)) return null;

  return {
    sessionsLeft: (100 - used) / perSession,
    windowsUntilReset: Math.floor(untilReset / (5 * HOUR_MS)),
  };
};

/**
 * The window's forecast, or null when it isn't well-founded: no percentage or
 * reset, a reset already past or further off than the window is long, or the
 * limit already reached. `hasFiveHour`: the Harness also reports a 5-hour window.
 */
export const forecast = (limit: LimitData, now: number, hasFiveHour = false): Forecast | null => {
  const minutes = limit.windowMinutes ?? DEFAULT_MINUTES.get(limit.kind) ?? null;

  if (limit.usedPercent === null || limit.resetsAt === null || minutes === null) return null;
  const duration = minutes * MINUTE_MS;
  const untilReset = Date.parse(limit.resetsAt) - now;

  if (!(untilReset > 0) || untilReset > duration + RESET_TOLERANCE_MS) return null;
  const used = Math.min(100, Math.max(0, limit.usedPercent));

  if (used >= 100 || limit.status === "reached") return null;
  const elapsed = Math.min(duration, Math.max(0, duration - untilReset));
  const expectedUsed = (elapsed / duration) * 100;
  const sessions = sessionsOf(limit, used, untilReset, hasFiveHour);
  const delta = used - expectedUsed;
  const projected = projection(used, elapsed, untilReset, duration);
  // On pace runs out just as it resets: say it lasts rather than alarm over minutes.
  const onPace = Math.round(Math.abs(delta)) <= ON_PACE && projected.runsOutInMs !== null;

  return {
    expectedUsed,
    delta,
    ...(onPace ? { runsOutInMs: null, lastsUntilReset: true } : projected),
    sessionsLeft: sessions?.sessionsLeft ?? null,
    windowsUntilReset: sessions?.windowsUntilReset ?? null,
  };
};

/** "10% in reserve", "12% in deficit", "On pace". */
export const paceWords = (f: Forecast): string => {
  const points = Math.round(Math.abs(f.delta));

  if (points <= ON_PACE) return "On pace";

  return f.delta < 0 ? `${points}% in reserve` : `${points}% in deficit`;
};

/** "2d 22h", "3h 34m", "40m", "<1m". */
export const spanWords = (ms: number): string => {
  if (ms < MINUTE_MS) return "<1m";

  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)}m`;

  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)}h ${Math.floor((ms % HOUR_MS) / MINUTE_MS)}m`;

  return `${Math.floor(ms / DAY_MS)}d ${Math.floor((ms % DAY_MS) / HOUR_MS)}h`;
};

/** "Runs out in 2d 22h", "Lasts until reset", or null while it's too early to say. */
export const runWords = (f: Forecast): string | null => {
  if (f.runsOutInMs !== null) return `Runs out in ${spanWords(f.runsOutInMs)}`;

  return f.lastsUntilReset ? "Lasts until reset" : null;
};

/** "About 2.6 full 5-hour windows left · 23 until reset", weekly only. */
export const sessionWords = (f: Forecast): string | null => {
  if (f.sessionsLeft === null || f.windowsUntilReset === null) return null;
  const left = Math.round(f.sessionsLeft * 10) / 10;
  const unit = left > 0 && left <= 1 ? "full 5-hour window" : "full 5-hour windows";

  return `About ${left} ${unit} left · ${f.windowsUntilReset} until reset`;
};

/** The chip's short form: when it runs out, else how it stands against the pace. */
export const shortForecast = (f: Forecast): string => {
  if (f.runsOutInMs !== null) return `runs out in ${spanWords(f.runsOutInMs)}`;

  return paceWords(f).toLowerCase();
};

/** Which of `cells` the pace marker sits on: the last cell that would still be full on pace. */
export const paceCell = (f: Forecast, cells: number): number =>
  Math.min(cells - 1, Math.max(0, Math.round(((100 - f.expectedUsed) / 100) * cells) - 1));

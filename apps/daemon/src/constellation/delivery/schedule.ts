import type { DigestWindow } from "./format.ts";

export interface DigestSchedule {
  readonly at: number;
  readonly start: number;
  readonly burst: string | null;
}

/**
 * The next digest wake, or null to keep `existing`. A new burst item restarts the debounce
 * from `now`, never past the window's start plus its ceiling; a fixed wake only moves earlier.
 */
export const nextDigest = (
  existing: DigestSchedule | undefined,
  window: DigestWindow,
  now: number
): DigestSchedule | null => {
  if (window.burst === null) {
    const at = now + window.debounceMs;

    return existing !== undefined && existing.at <= at ? null : { at, start: now, burst: null };
  }

  if (existing?.burst === window.burst) return null;
  const start = existing === undefined || existing.burst === null ? now : existing.start;

  return {
    at: Math.min(now + window.debounceMs, start + window.ceilingMs),
    start,
    burst: window.burst,
  };
};

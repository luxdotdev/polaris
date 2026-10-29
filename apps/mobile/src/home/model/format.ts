/** Short labels Home and Hosts share: ages, counts and Harness names. */
import { harnessEntry } from "@polaris/protocol";

const MINUTE = 60_000;

const HOUR = 60 * MINUTE;

const DAY = 24 * HOUR;

/** "now", "42m", "3h", "2d": how long ago, at the precision a glance needs. */
export const age = (since: number, now: number): string => {
  const elapsed = Math.max(0, now - since);

  if (elapsed < MINUTE) return "now";

  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;

  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;

  return `${Math.floor(elapsed / DAY)}d`;
};

/** "lucas-mac-studio.tail0.ts.net" → "lucas-mac-studio"; IP addresses stay whole. */
export const shortHostName = (name: string): string =>
  /^[a-z][\w-]*\./i.test(name) ? (name.split(".")[0] ?? name) : name;

/** "1 host", "4 hosts". */
export const counted = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/** The Harness's product name ("Claude Code"), or its kind when the catalogue doesn't know it. */
export const harnessName = (kind: string): string => harnessEntry(kind)?.name ?? kind;

/** The index on needs you rows: 01, 02 … 10, 11. */
export const rowIndex = (position: number): string => String(position + 1).padStart(2, "0");

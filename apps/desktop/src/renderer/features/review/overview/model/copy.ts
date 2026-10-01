/** Overview's words for times and counts. */
const MINUTE = 60_000;

const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export const ago = (iso: string, now: number): string => {
  const ms = now - Date.parse(iso);

  if (!Number.isFinite(ms) || ms < MINUTE) return "just now";

  if (ms < 60 * MINUTE) return unit(Math.floor(ms / MINUTE), "minute");

  if (ms < 24 * 60 * MINUTE) return unit(Math.floor(ms / (60 * MINUTE)), "hour");

  return unit(Math.floor(ms / (24 * 60 * MINUTE)), "day");
};

/** "41s", "2m 05s". */
export const duration = (ms: number) => {
  const s = Math.round(ms / 1000);

  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

/** "~38k tokens", "~1.2M tokens". */
export const tokens = (n: number) => {
  if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1)}M tokens`;

  return n >= 1000 ? `~${Math.round(n / 1000)}k tokens` : `${n} tokens`;
};

export const count = (n: number, word: string, many = `${word}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? word : many}`;

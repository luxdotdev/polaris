/** Short forms the constellation view prints: id ranges, SHAs and how long something has run. */
const ID = /^(.*?)(\d+)$/;

const split = (id: string) => {
  const match = ID.exec(id);

  return match === null
    ? { prefix: id, n: null }
    : { prefix: match[1] ?? "", n: Number(match[2] ?? "") };
};

const rangeText = (prefix: string, from: number, to: number) => {
  if (from === to) return `${prefix}${from}`;

  return to === from + 1 ? `${prefix}${from}, ${prefix}${to}` : `${prefix}${from}–${prefix}${to}`;
};

/** "B1–B3", "A1, C4": consecutive ids with one prefix fold into a range. */
export const idRanges = (ids: ReadonlyArray<string>): string => {
  const parts: Array<string> = [];
  let run: { prefix: string; from: number; to: number } | null = null;

  for (const id of ids) {
    const { prefix, n } = split(id);

    if (n !== null && run !== null && run.prefix === prefix && n === run.to + 1) {
      run.to = n;
      continue;
    }

    if (run !== null) parts.push(rangeText(run.prefix, run.from, run.to));
    run = n === null ? null : { prefix, from: n, to: n };

    if (n === null) parts.push(id);
  }

  if (run !== null) parts.push(rangeText(run.prefix, run.from, run.to));

  return parts.join(", ");
};

export const shortSha = (sha: string) => sha.slice(0, 7);

const MINUTE = 60_000;

/** "now", "4m", "2h", "2h 5m": how long something has run, from epoch ms. */
export const elapsed = (sinceMs: number, now: number): string => {
  const ms = now - sinceMs;

  if (!Number.isFinite(ms) || ms < MINUTE) return "now";
  const minutes = Math.floor(ms / MINUTE);

  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};

/** An ISO timestamp's age, as `elapsed`. */
export const age = (iso: string, now: number): string => elapsed(Date.parse(iso), now);

/** Short forms the tab prints: id ranges, SHAs, durations, actors. */
import type { HarnessKind } from "@polaris/protocol";

const ID = /^(.*?)(\d+)$/;

const split = (id: string) => {
  const match = ID.exec(id);

  return match === null
    ? { prefix: id, n: null }
    : { prefix: match[1] ?? "", n: Number(match[2] ?? "") };
};

/** "B1–B5", "C1, C7, C9–C12": consecutive ids with one prefix fold into a range. */
export const idRanges = (ids: ReadonlyArray<string>): string => {
  const parts: Array<string> = [];
  let run: { prefix: string; from: number; to: number } | null = null;

  const close = () => {
    if (run === null) return;
    const { prefix, from, to } = run;

    parts.push(
      from === to
        ? `${prefix}${from}`
        : to === from + 1
          ? `${prefix}${from}, ${prefix}${to}`
          : `${prefix}${from}–${prefix}${to}`
    );
    run = null;
  };

  for (const id of ids) {
    const { prefix, n } = split(id);

    if (n === null) {
      close();
      parts.push(id);
    } else if (run !== null && run.prefix === prefix && n === run.to + 1) run.to = n;
    else {
      close();
      run = { prefix, from: n, to: n };
    }
  }

  close();

  return parts.join(", ");
};

export const shortSha = (sha: string) => sha.slice(0, 7);

const MINUTE = 60_000;

/** "now", "4m", "2h", "2h 5m": how long something has run. */
export const span = (since: string, now: number): string => {
  const ms = now - Date.parse(since);

  if (!Number.isFinite(ms) || ms < MINUTE) return "now";
  const minutes = Math.floor(ms / MINUTE);

  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;

  return rest === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h ${rest}m`;
};

const HARNESS_WORD: Readonly<Partial<Record<HarnessKind, string>>> = {
  claude: "claude",
  codex: "codex",
  opencode: "opencode",
};

export const harnessWord = (harness: HarnessKind | null) =>
  harness === null ? null : (HARNESS_WORD[harness] ?? harness);

/** "codex · gpt-6.1-sol", "codex · on devbox", "lead · opus 5.5". */
export const actorLine = (
  who: string | null,
  model: string | null,
  remoteHost: string | null
): string => {
  const second = remoteHost === null ? model : `on ${remoteHost}`;

  return [who, second].filter((part) => part !== null && part !== "").join(" · ");
};

export const pluralize = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** "18:20" in the viewer's clock. */
export const clock = (iso: string) => {
  const date = new Date(iso);

  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

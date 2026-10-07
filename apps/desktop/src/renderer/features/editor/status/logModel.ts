/** Pure reading of a server log for its tab: counts, filters, find and the copied text. */
import type { LogLevel, LogLine } from "./log.ts";

export interface LogFilter {
  /** Counts double as filters: showing only errors, only warnings, or both. */
  readonly only: ReadonlySet<LogLevel>;
  readonly query: string;
}

export const counts = (lines: readonly LogLine[]) => {
  let errors = 0;
  let warnings = 0;

  for (const line of lines)
    if (line.level === "error") errors++;
    else if (line.level === "warning") warnings++;

  return { errors, warnings };
};

export const visibleLines = (lines: readonly LogLine[], filter: LogFilter) => {
  const query = filter.query.toLowerCase();

  return lines.filter(
    (line) =>
      (filter.only.size === 0 || filter.only.has(line.level)) &&
      (query === "" || line.text.toLowerCase().includes(query))
  );
};

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

/** "14:02:11.204", in local time. */
export const timeText = (at: number) => {
  const date = new Date(at);

  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
};

const LEVEL_WORDS: Readonly<Record<LogLevel, string>> = {
  error: "error",
  warning: "warn",
  info: "info",
  debug: "debug",
};

export const levelText = (level: LogLevel) => LEVEL_WORDS[level];

export const copyText = (lines: readonly LogLine[]) =>
  lines.map((line) => `${timeText(line.at)} ${levelText(line.level)} ${line.text}`).join("\n");

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** Splits a line around find matches, for highlighting. */
export const matchParts = (text: string, query: string) => {
  if (query === "") return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;

  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }

  if (from < text.length) parts.push({ text: text.slice(from), match: false });

  return parts;
};

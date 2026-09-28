#!/usr/bin/env bun
// commit-msg: removes agent session links (Claude-Session trailers, claude.ai session URLs)
// from the message file in place. This repo doesn't record them.
import { readFileSync, writeFileSync } from "node:fs";

const SESSION_LINE = /^(?:Claude-Session:.*|\s*https:\/\/claude\.ai\/code\/session_\S*\s*)$/;

/** The message without session lines, or null when there were none. */
export const stripSessionLines = (message: string): string | null => {
  const lines = message.split("\n");
  const kept = lines.filter((line) => !SESSION_LINE.test(line));

  if (kept.length === lines.length) return null;

  const stripped = kept.join("\n").replace(/\n{2,}$/, "\n");

  return stripped.endsWith("\n") ? stripped : `${stripped}\n`;
};

if (import.meta.main) {
  const [file] = process.argv.slice(2);

  if (file !== undefined) {
    const stripped = stripSessionLines(readFileSync(file, "utf8"));

    if (stripped !== null) writeFileSync(file, stripped);
  }
}

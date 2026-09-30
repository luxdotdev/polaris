/**
 * The Host aliases in `~/.ssh/config`, for the welcome's "found on this Mac"
 * line and the setup card. A minimal read: literal `Host` names only, no
 * `Include`s and no wildcard or negated patterns. `features/machines` has the
 * full parser; this gives way to it once that lands.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOST_LINE = /^\s*host\s*(?:=\s*|\s)(.*)$/i;

const isLiteral = (name: string) => name !== "" && !/[*?!]/.test(name) && !name.startsWith("-");

/** Every literal alias in the config's text, in file order, each once. */
export const parseSshHosts = (text: string): ReadonlyArray<string> => {
  const aliases = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    const match = HOST_LINE.exec(line.replace(/#.*$/, ""));

    for (const name of match?.[1]?.split(/\s+/) ?? []) {
      const alias = name.replace(/^"|"$/g, "");

      if (isLiteral(alias)) aliases.add(alias);
    }
  }

  return [...aliases];
};

/** The aliases in `~/.ssh/config`; none when the file is missing or unreadable. */
export const readSshHosts = (path = join(homedir(), ".ssh", "config")): ReadonlyArray<string> => {
  try {
    return parseSshHosts(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
};

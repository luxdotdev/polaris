/**
 * Browser tabs kept across restarts in `<userData>/browser/tabs.json`, written a moment after the
 * last change. Losing the file only loses the tabs.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Option, Schema } from "effect";
import { KeptFile, type KeptSession } from "./tabs.ts";

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(KeptFile));

const encode = Schema.encodeSync(Schema.fromJsonString(KeptFile));

const SAVE_DELAY_MS = 500;

export const openKeptTabs = (userData: string) => {
  const dir = join(userData, "browser");
  const path = join(dir, "tabs.json");
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: ReadonlyArray<KeptSession> | null = null;

  const write = () => {
    timer = null;

    if (pending === null) return;

    const sessions = pending;

    pending = null;

    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${path}.part`, encode({ version: 1, sessions }));
      renameSync(`${path}.part`, path);
    } catch (error) {
      console.warn("[browser] could not keep tabs", error);
    }
  };

  return {
    read: (): ReadonlyArray<KeptSession> =>
      existsSync(path)
        ? Option.match(decode(readFileSync(path, "utf8")), {
            onNone: () => [],
            onSome: (file) => file.sessions,
          })
        : [],
    save: (sessions: ReadonlyArray<KeptSession>) => {
      pending = sessions;
      timer ??= setTimeout(write, SAVE_DELAY_MS);
    },
    /** Writes what is pending now, on quit. */
    flush: () => {
      if (timer !== null) clearTimeout(timer);
      write();
    },
  };
};

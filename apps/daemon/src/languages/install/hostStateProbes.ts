import { access, opendir, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import type { LanguageHostPrerequisite } from "@polaris/protocol";
import type { Requirement } from "../catalog/model.ts";
import { abortable, checkAbort } from "./validation.ts";

export type HostPresence = Omit<LanguageHostPrerequisite, "requirement">;

const unknown: HostPresence = { presence: "unknown", path: null, version: null };

const missing: HostPresence = { presence: "missing", path: null, version: null };

const absent = Schema.Struct({ code: Schema.Literals(["ENOENT", "ENOTDIR"]) });

interface HostExecutableNames {
  readonly [id: string]: readonly string[];
}

const executables: HostExecutableNames = {
  node: ["node"],
  shellcheck: ["shellcheck"],
  uv: ["uv"],
  "python-interpreter": ["python3.13", "python3.14", "python3", "python"],
  cargo: ["cargo"],
  rustfmt: ["rustfmt"],
  java: ["java"],
  php: ["php"],
  go: ["go"],
};

/** Presence only: fixed locations, no PATH, Workspace, configured code or executable invocation. */
export function createHostPrerequisiteProbe(
  options: {
    home?: string;
    directories?: readonly string[];
  } = {}
) {
  const home = options.home ?? homedir();

  const directories = options.directories ?? [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/opt/homebrew/opt/python@3.13/bin",
    "/usr/local/opt/python@3.13/bin",
    join(home, ".local/bin"),
    join(home, ".cargo/bin"),
  ];

  return () => {
    let checks = 0;
    const cache = new Map<string, Promise<HostPresence>>();

    const inspect = async (path: string, signal: AbortSignal, directory = false) => {
      checkAbort(signal);

      if (checks >= 128) return unknown;
      checks++;

      try {
        const canonical = await abortable(realpath(path), signal);
        const info = await abortable(stat(canonical), signal);

        if (directory ? !info.isDirectory() : !info.isFile()) return missing;

        if (!directory) await abortable(access(canonical, constants.X_OK), signal);
        checkAbort(signal);

        return { presence: "present", path: canonical, version: null } satisfies HostPresence;
      } catch (cause) {
        checkAbort(signal);

        return Schema.is(absent)(cause) ? missing : unknown;
      }
    };

    const scan = async (root: string, suffix: string, signal: AbortSignal, directory = false) => {
      let count = 0;

      try {
        const entries = await opendir(root);

        for await (const entry of entries) {
          checkAbort(signal);

          if (++count > 32) return unknown;

          const fact = await inspect(join(root, entry.name, suffix), signal, directory);

          if (fact.presence !== "missing") return fact;
        }
      } catch (cause) {
        checkAbort(signal);

        if (!Schema.is(absent)(cause)) return unknown;
      }

      return missing;
    };

    const find = async (requirement: Requirement, signal: AbortSignal): Promise<HostPresence> => {
      if (requirement.id === "rust-src")
        return scan(join(home, ".rustup/toolchains"), "lib/rustlib/src/rust/library", signal, true);

      const names = executables[requirement.id];

      if (names === undefined) return unknown;

      for (const directory of directories.slice(0, 16)) {
        for (const name of names) {
          const fact = await inspect(join(directory, name), signal);

          if (fact.presence !== "missing") return fact;
        }
      }

      if (requirement.id === "python-interpreter")
        return directories.length > 16
          ? unknown
          : scan(join(home, ".local/share/uv/python"), "bin/python3", signal);

      return directories.length > 16 ? unknown : missing;
    };

    return {
      probe(requirement: Requirement, signal: AbortSignal) {
        let pending = cache.get(requirement.id);

        if (pending === undefined) {
          pending = find(requirement, signal);
          cache.set(requirement.id, pending);
        }

        return pending;
      },
      stats: () => ({ checks }),
    };
  };
}

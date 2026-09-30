/**
 * What a terminal runs, and what the drawer says about how it ended. Pure.
 */
import type { TabStatus } from "./tabs.ts";

export interface Launch {
  readonly argv: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * `terminal.open` takes no environment, so variables ride in front of the
 * command through `env(1)`, which every Host has.
 */
export const argvOf = (launch: Launch): ReadonlyArray<string> => {
  const pairs = Object.entries(launch.env).map(([name, value]) => `${name}=${value}`);

  return pairs.length === 0 ? launch.argv : ["env", ...pairs, "--", ...launch.argv];
};

/** The line under an ended terminal. */
export const endedLine = (status: TabStatus): string | null => {
  switch (status.kind) {
    case "exited":
      if (status.code === null)
        return "This terminal ended. The daemon restarted or the process was stopped";

      return status.code === 0 ? "Process exited" : `Process exited with code ${status.code}`;
    case "failed":
      return status.message;
    case "opening":
    case "live":
      return null;
  }
};

/** The last path segment, for a tab's title ("~/code/polaris" → "polaris"). */
export const baseName = (path: string) => {
  const parts = path.split("/").filter((p) => p !== "");

  return parts.at(-1) ?? path;
};

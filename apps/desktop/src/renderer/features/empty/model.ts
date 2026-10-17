/**
 * The words of the empty states (DESIGN.md, Empty states), from counts. Pure,
 * so the copy is tested; glossary words lowercase (rule/glossary-lowercase).
 */
import { separatorOf, tildePath } from "../../../shared/hostPath.ts";

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The fact when a Workspace has sessions but none is open. */
export const noSelectionFact = (sessions: number, workspace: string) =>
  `${plural(sessions, "session")} in ${workspace} · K to jump`;

/** The kicker over a stage: "polaris · Mac Studio", or just the Host. */
export const stageKicker = (host: string, workspace: string | null) =>
  workspace === null ? `Set up · ${host}` : `${workspace} · ${host}`;

/** The line under "Where does your code live?"; a session never waits for a workspace. */
export const hostStageLine = (hostCount: number) =>
  hostCount > 1
    ? "Add a workspace on any of your hosts, or start a session in your home folder."
    : "Add a workspace, or start a session in your home folder. Remote hosts can come now or later.";

/** The line under the headline with no Host at all; a Windows PC can't be one yet. */
export const noHostLine = (windows: boolean) =>
  windows
    ? "Agents run on a host. This PC can't be one yet, so add a WSL distro or any machine you reach over SSH."
    : "Agents run on a host: any machine you reach over SSH.";

/** The add-a-host caption with no Host yet: what can be added, and what's already found. */
export const firstHostCaption = (windows: boolean, sshHosts: number): string => {
  const what = windows
    ? "A WSL distro on this PC, or a machine over SSH"
    : "Any machine you can reach over SSH";

  return sshHosts > 0 ? `${what} · ${plural(sshHosts, "host")} in ~/.ssh/config` : what;
};

/** "A", "A and B", "A, B, and C": the serial comma, as in the rest of the copy. */
export const serialList = (items: ReadonlyArray<string>): string => {
  if (items.length <= 2) return items.join(" and ");

  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
};

/** The connect-a-host caption: what's in `~/.ssh/config`, else the Hosts already added. */
export const connectHostCaption = (sshHosts: number, otherHosts: number): string => {
  if (sshHosts > 0) return `${plural(sshHosts, "host")} in ~/.ssh/config · optional`;

  if (otherHosts > 0) return `${plural(otherHosts, "other host")} added · optional`;

  return "Any machine you can reach over SSH · optional";
};

export interface ReadyHarness {
  readonly name: string;
  readonly version: string | null;
}

/** "Claude Code 2.1.4 and Codex 0.52.0 are ready on Mac Studio" (Paper 57Q-1). */
export const readyLine = (ready: ReadonlyArray<ReadyHarness>, host: string): string => {
  if (ready.length === 0) return `No harness is ready on ${host} yet`;

  const named = ready.map((h) => (h.version === null ? h.name : `${h.name} ${h.version}`));

  const shown =
    named.length > 2 ? [...named.slice(0, 2), plural(named.length - 2, "other")] : named;

  return `${serialList(shown)} ${ready.length === 1 ? "is" : "are"} ready on ${host}`;
};

/** A workspace path for a one-line caption: `~/…` under home, else its last folders kept whole. */
export const captionPath = (path: string, home: string | null, max = 48): string => {
  const shown = tildePath(path, home);

  if (shown.length <= max) return shown;

  const sep = separatorOf(path);
  const parts = sep === "\\" ? shown.split(/[\\/]/) : shown.split("/");
  let tail = parts[parts.length - 1] ?? shown;

  for (let i = parts.length - 2; i > 0 && tail.length + (parts[i]?.length ?? 0) + 3 <= max; i--) {
    tail = `${parts[i]}${sep}${tail}`;
  }

  return `…${sep}${tail}`;
};

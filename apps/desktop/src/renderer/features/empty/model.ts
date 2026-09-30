/**
 * The words of the empty states (DESIGN.md, Empty states), from counts. Pure,
 * so the copy is tested; glossary words lowercase (rule/glossary-lowercase).
 */

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

/** A path the user typed: trimmed, `~` kept for the Host to expand, trailing slashes dropped. */
export const cleanPath = (typed: string): string | null => {
  const path = typed.trim().replace(/(.)\/+$/, "$1");

  return path === "~" || path.startsWith("/") || path.startsWith("~/") ? path : null;
};

/** `~/x` → `<home>/x` when the Host's home is known; the Daemon wants an absolute path. */
export const absolutePath = (path: string, homeDir: string | null): string | null => {
  if (path.startsWith("/")) return path;

  if (homeDir === null) return null;

  return path === "~" ? homeDir : `${homeDir}${path.slice(1)}`;
};

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
  const shown =
    home !== null && home !== "" && (path === home || path.startsWith(`${home}/`))
      ? `~${path.slice(home.length)}`
      : path;

  if (shown.length <= max) return shown;

  const parts = shown.split("/");
  let tail = parts[parts.length - 1] ?? shown;

  for (let i = parts.length - 2; i > 0 && tail.length + (parts[i]?.length ?? 0) + 3 <= max; i--) {
    tail = `${parts[i]}/${tail}`;
  }

  return `…/${tail}`;
};

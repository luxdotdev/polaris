/**
 * The words of the empty states (DESIGN.md, Empty states), from counts. Pure,
 * so the copy is tested; glossary words lowercase (rule/glossary-lowercase).
 */

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The fact under "Nothing needs you": what is still going on, across Hosts. */
export const nothingNeedsYouFact = (working: number, hosts: number): string => {
  if (working === 0) return "No agent sessions are working";

  return hosts <= 1
    ? `${plural(working, "session")} working`
    : `${plural(working, "session")} working on ${plural(hosts, "host")}`;
};

/** The fact when a Workspace has sessions but none is open. */
export const noSelectionFact = (sessions: number, workspace: string) =>
  `${plural(sessions, "session")} in ${workspace} · K to jump`;

/** The kicker over a stage: "polaris · Mac Studio", or just the Host. */
export const stageKicker = (host: string, workspace: string | null) =>
  workspace === null ? `Set up · ${host}` : `${workspace} · ${host}`;

/** The line under "Where does your code live?". */
export const hostStageLine = (hostCount: number) =>
  hostCount > 1
    ? "Add a workspace on any of your hosts to start a session"
    : "Add a workspace to start your first session. Remote hosts can come now or later";

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

/** "Claude Code and Codex are ready on Mac Studio", from the Harnesses that can start there. */
export const readyLine = (names: ReadonlyArray<string>, host: string): string => {
  if (names.length === 0) return `No harness is ready on ${host} yet`;

  const [first, second] = names;

  const list =
    names.length > 2
      ? `${first}, ${second} and ${plural(names.length - 2, "other")}`
      : names.join(" and ");

  return `${list} ${names.length === 1 ? "is" : "are"} ready on ${host}`;
};

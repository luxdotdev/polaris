/**
 * Where Origins come from: `git.blame` on the file's Host for the one line asked about, and
 * `origins.match` on every connected Host, each answer kept as it arrives (DESIGN.md, Origins).
 */
import type { BlameLine, OriginLineQuery, WorkspaceId, WorktreeId } from "@polaris/protocol";
import type { AppState } from "../../../store/store.ts";
import { polaris } from "../../bridge.ts";
import type { EditorFile } from "../api.ts";
import { isUnder } from "../explorer/model/paths.ts";
import type { HostAnswer, HostOrigins } from "./model.ts";

let appState: (() => AppState) | null = null;

/** The Editor, starting: Origins read Hosts and Workspaces from the app from now on. */
export const bindOriginsApp = (app: () => AppState) => {
  appState = app;
};

export interface Checkout {
  readonly workspaceId: WorkspaceId;
  readonly worktreeId: WorktreeId | null;
  /** The checkout's directory on the Host. */
  readonly root: string;
}

/** Where a file is checked out: its Workspace, or the Worktree of it the file is in. */
export const checkoutOf = (file: EditorFile): Checkout | null => {
  const model = appState?.().hostModels[file.hostKey];
  const workspace = model?.workspaces.get(file.workspaceId);

  if (model === undefined || workspace === undefined) return null;

  const worktree = [...model.worktrees.values()]
    .filter((w) => w.workspaceId === workspace.id && !w.isMain && isUnder(file.path, w.path))
    .toSorted((a, b) => b.path.length - a.path.length)[0];

  if (worktree !== undefined)
    return { workspaceId: workspace.id, worktreeId: worktree.id, root: worktree.path };

  return isUnder(file.path, workspace.path)
    ? { workspaceId: workspace.id, worktreeId: null, root: workspace.path }
    : null;
};

export interface Blamed {
  readonly repoKey: string;
  readonly line: BlameLine;
}

/** A few hundred lines' answers; the oldest go first. */
const LIMIT = 256;

const remember = <V>(cache: Map<string, V>, key: string, value: V) => {
  cache.set(key, value);

  if (cache.size > LIMIT) cache.delete(cache.keys().next().value ?? key);
};

const blames = new Map<string, Promise<Blamed | null>>();

/**
 * Line `line` of the file on disk; `version` names the disk text and HEAD, so a save or a
 * commit asks again. Null outside a repository, or when the Host can't blame.
 */
export const blameLine = (file: EditorFile, line: number, version: string) => {
  const key = `${file.hostKey}\u0000${file.path}\u0000${version}\u0000${line}`;
  const known = blames.get(key);

  if (known !== undefined) return known;
  const asked = askBlame(file, line);

  remember(blames, key, asked);

  return asked;
};

const askBlame = async (file: EditorFile, line: number): Promise<Blamed | null> => {
  const checkout = checkoutOf(file);

  if (checkout === null || !canAsk(file.hostKey)) return null;

  const result = await polaris().request("git.blame", {
    hostKey: file.hostKey,
    workspaceId: checkout.workspaceId,
    worktreeId: checkout.worktreeId,
    path: file.path,
    startLine: line,
    endLine: line,
  });

  if (!result.ok) return null;
  const blamed = result.value.lines[0];

  return blamed === undefined ? null : { repoKey: result.value.repoKey, line: blamed };
};

const canAsk = (hostKey: string) =>
  appState?.()
    .hosts.find((h) => h.key === hostKey)
    ?.status.capabilities.includes("origins") === true;

/** Each Host's answer for one line, as they arrive. */
export interface Lookup {
  readonly hosts: () => ReadonlyArray<HostOrigins>;
  readonly subscribe: (listener: () => void) => () => void;
}

const lookups = new Map<string, Lookup>();

interface AskedHost {
  readonly key: string;
  readonly label: string;
  /** False for a Host that isn't connected: the card says it is offline. */
  readonly ask: boolean;
}

/** Hosts to ask: connected ones that can; every other Host is offline for the card. */
const askable = (): ReadonlyArray<AskedHost> =>
  (appState?.().hosts ?? []).flatMap((h): ReadonlyArray<AskedHost> => {
    if (h.status.state !== "connected") return [{ key: h.key, label: h.label, ask: false }];

    return h.status.capabilities.includes("origins")
      ? [{ key: h.key, label: h.label, ask: true }]
      : [];
  });

/**
 * Asks every Host who wrote `query`'s line. One Host's answer never waits on another's; a
 * Host that fails to answer counts as offline. `version` keys an uncommitted line's answers.
 */
export const lookupOrigins = (repoKey: string, query: OriginLineQuery, version: string): Lookup => {
  const hosts = askable();

  const key = [
    repoKey,
    query.path,
    query.hash ?? "",
    query.commitSha ?? version,
    hosts.map((h) => `${h.key}:${h.ask}`).join(","),
  ].join("\u0000");

  const known = lookups.get(key);

  if (known !== undefined) return known;
  const lookup = startLookup(repoKey, query, hosts);

  remember(lookups, key, lookup);

  return lookup;
};

const startLookup = (
  repoKey: string,
  query: OriginLineQuery,
  hosts: ReadonlyArray<AskedHost>
): Lookup => {
  let answers: ReadonlyArray<HostOrigins> = hosts.map((h) => ({
    hostKey: h.key,
    label: h.label,
    answer: h.ask ? { kind: "pending" } : { kind: "offline" },
  }));

  const listeners = new Set<() => void>();

  const settle = (hostKey: string, answer: HostAnswer) => {
    answers = answers.map((a) => (a.hostKey === hostKey ? { ...a, answer } : a));

    for (const listener of listeners) listener();
  };

  for (const host of hosts.filter((h) => h.ask)) {
    void polaris()
      .request("origins.match", { hostKey: host.key, repoKey, lines: [query] })
      .then(
        (result) =>
          settle(
            host.key,
            result.ok
              ? { kind: "answered", lines: result.value.lines, sessions: result.value.sessions }
              : { kind: "offline" }
          ),
        () => settle(host.key, { kind: "offline" })
      );
  }

  return {
    hosts: () => answers,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
};

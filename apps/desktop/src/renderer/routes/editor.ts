/**
 * Open in editor: the one action every `path:line` in the app runs (transcripts, Claims,
 * Overview, findings, Changes, Review), and ⌘P's pick. It selects the Workspace holding the
 * file, switches to Edit, and leaves an open request the editor pane takes with
 * `useEditorOpenRequest()`. Each request has its own `seq`, so the same place can be asked again.
 */
import type { Workspace, WorkspaceId, Worktree } from "@polaris/protocol";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { AppState } from "../store/store.ts";
import type { ShellActions } from "./navigation.ts";

export interface EditorLocation {
  readonly hostKey: string;
  /** Absolute on the Host, or relative to `root`. */
  readonly path: string;
  /** What a relative `path` is relative to: a session's cwd, a checkout, a Workspace. */
  readonly root?: string | null;
  /** The Workspace to open it in; found from the path when omitted. */
  readonly workspaceId?: WorkspaceId | null;
  /** 1-based. */
  readonly line?: number | null;
  /** 1-based. */
  readonly column?: number | null;
  /** A folder to show in the explorer (a Review Checkout's root), not a file to open. */
  readonly folder?: boolean;
}

export interface EditorOpenRequest {
  readonly seq: number;
  readonly hostKey: string;
  readonly workspaceId: WorkspaceId;
  /** Absolute on the Host. */
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
  readonly folder: boolean;
}

interface EditorRoute {
  readonly request: EditorOpenRequest | null;
}

export const editorRoute = createStore<EditorRoute>(() => ({ request: null }));

let seq = 0;

/** The latest open request; the editor pane opens or focuses its tab and reveals the line. */
export const useEditorOpenRequest = (): EditorOpenRequest | null =>
  useStore(editorRoute, (s) => s.request);

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);

/** `path` made absolute against `root`, with `.` and `..` segments folded. */
export const resolvePath = (path: string, root: string | null | undefined): string => {
  const joined = path.startsWith("/") || !root ? path : `${trimSlash(root)}/${path}`;
  const parts: Array<string> = [];

  for (const part of joined.split("/")) {
    if (part === "" || part === ".") continue;

    if (part === "..") parts.pop();
    else parts.push(part);
  }

  return joined.startsWith("/") ? `/${parts.join("/")}` : parts.join("/");
};

const contains = (root: string, path: string) => {
  const base = trimSlash(root);

  return path === base || path.startsWith(base === "/" ? "/" : `${base}/`);
};

/** macOS's top-level links: the Daemon reports real paths (`/private/var/…`), a Workspace may keep the link's. */
const LINKED = ["/var", "/tmp", "/etc"];

/** `path` spelled the way `root` spells it, when one uses a macOS link and the other its target. */
export const spelledAs = (root: string, path: string): string => {
  if (contains(root, path)) return path;

  for (const link of LINKED) {
    const real = `/private${link}`;

    const swapped = contains(real, path)
      ? link + path.slice(real.length)
      : contains(link, path)
        ? real + path.slice(link.length)
        : null;

    if (swapped !== null && contains(root, swapped)) return swapped;
  }

  return path;
};

export interface HostPlaces {
  readonly workspaces: ReadonlyMap<string, Workspace>;
  readonly worktrees: ReadonlyMap<string, Worktree>;
}

// The main Worktree is the Workspace's own folder, often spelled as its realpath; the Workspace's spelling wins.
const rootsOf = (places: HostPlaces) => [
  ...[...places.workspaces.values()].map((w) => ({ id: w.id, root: w.path })),
  ...[...places.worktrees.values()].flatMap((w) =>
    w.isMain ? [] : [{ id: w.workspaceId, root: w.path }]
  ),
];

/**
 * The Workspace whose folder, or one of whose Worktrees, holds `path` most closely, and the
 * path spelled as that folder spells it (so tabs, breadcrumbs and the tree agree).
 */
export const placeFor = (
  places: HostPlaces,
  path: string,
  only: WorkspaceId | null = null
): { readonly id: WorkspaceId; readonly path: string } | null => {
  let best: { readonly id: WorkspaceId; readonly path: string; readonly length: number } | null =
    null;

  for (const { id, root } of rootsOf(places)) {
    const spelled = spelledAs(root, path);

    if (
      (only === null || id === only) &&
      contains(root, spelled) &&
      root.length > (best?.length ?? -1)
    )
      best = { id, path: spelled, length: root.length };
  }

  return best === null ? null : { id: best.id, path: best.path };
};

export const workspaceFor = (places: HostPlaces, path: string): WorkspaceId | null =>
  placeFor(places, path)?.id ?? null;

const positive = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) || n < 1 ? null : Math.floor(n);

/** The request for `location`, or null when no Workspace on its Host holds the file. */
export const editorRequest = (
  app: Pick<AppState, "hostModels">,
  location: EditorLocation
): Omit<EditorOpenRequest, "seq"> | null => {
  const resolved = resolvePath(location.path, location.root);
  const model = app.hostModels[location.hostKey];

  const place =
    model === undefined ? null : placeFor(model, resolved, location.workspaceId ?? null);

  const workspaceId = location.workspaceId ?? place?.id ?? null;
  const path = place?.path ?? resolved;

  if (workspaceId === null || !path.startsWith("/")) return null;

  return {
    hostKey: location.hostKey,
    workspaceId,
    path,
    line: positive(location.line),
    column: positive(location.column),
    folder: location.folder ?? false,
  };
};

export type OpenInEditorActions = Pick<ShellActions, "selectWorkspace" | "setMode">;

export interface OpenInEditorContext {
  readonly app: Pick<AppState, "hostModels">;
  readonly actions: OpenInEditorActions;
  /** The Workspace selected now; switching to it again would drop the selected session. */
  readonly selected: { readonly hostKey: string | null; readonly workspaceId: string | null };
}

/** Opens `location` in Edit; false when it isn't inside any Workspace on its Host. */
export const openInEditor = (context: OpenInEditorContext, location: EditorLocation): boolean => {
  const request = editorRequest(context.app, location);

  if (request === null) return false;

  const { hostKey, workspaceId } = request;

  if (context.selected.hostKey !== hostKey || context.selected.workspaceId !== workspaceId)
    context.actions.selectWorkspace({ hostKey, workspaceId });

  context.actions.setMode("edit");
  seq += 1;
  editorRoute.setState({ request: { ...request, seq } });

  return true;
};

/** `path:line` or `path:line:column` as written in transcripts and tool output. */
export interface ParsedLocation {
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
}

export const parseLocation = (text: string): ParsedLocation => {
  const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(text.trim());

  if (match === null) return { path: text.trim(), line: null, column: null };

  return {
    path: match[1] ?? "",
    line: Number(match[2]),
    column: match[3] === undefined ? null : Number(match[3]),
  };
};

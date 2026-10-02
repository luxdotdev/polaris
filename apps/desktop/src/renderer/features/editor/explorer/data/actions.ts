/**
 * Create, rename and delete through the Daemon's `files` RPCs (capability
 * `files.manage`). A refusal toasts with the Host's reason; the watcher and
 * an explicit re-list put the result in the tree.
 */
import { PixelFailedIcon, showToast } from "@polaris/ui";
import { createElement } from "react";
import { polaris } from "../../../bridge.ts";
import { closeTab, openFile, renameFile } from "../../runtime/actions.ts";
import type { TabsView } from "../../runtime/hooks.ts";
import { basename, dirname, isUnder, join, validName } from "../model/paths.ts";
import { expandTo } from "../model/tree.ts";
import { type Draft, explorerOf, patchExplorer, setListing } from "./store.ts";

export interface Place {
  readonly key: string;
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly root: string;
}

const failed = (title: string, message: string) =>
  showToast({
    source: "starlight",
    icon: createElement(PixelFailedIcon, { size: 16 }),
    title,
    message,
  });

const relist = async (place: Place, dir: string) => {
  const result = await polaris().request("files.listDir", { hostKey: place.hostKey, path: dir });

  if (result.ok) {
    setListing(place.key, dir, {
      kind: "ready",
      entries: result.value.map(({ name, path, kind }) => ({ name, path, kind })),
    });
  }
};

export const startDraft = (key: string, draft: Draft) =>
  patchExplorer(key, (s) =>
    draft.kind === "create" ? { draft, expanded: new Set(s.expanded).add(draft.dir) } : { draft }
  );

export const cancelDraft = (key: string) => patchExplorer(key, () => ({ draft: null }));

const create = async (place: Place, dir: string, entry: "file" | "directory", name: string) => {
  const path = join(dir, name);

  const result = await polaris().request("files.create", {
    hostKey: place.hostKey,
    path,
    kind: entry,
  });

  if (!result.ok) {
    failed(`Couldn't create ${name}`, result.error.message);

    return;
  }

  // A nested name ("a/b.ts") makes folders on the way: open them all.
  patchExplorer(place.key, (s) => ({
    expanded: expandTo(s.expanded, place.root, path),
    focused: path,
  }));
  await relist(place, dir);

  if (entry === "file") openFile({ hostKey: place.hostKey, workspaceId: place.workspaceId, path });
};

const rename = async (place: Place, path: string, name: string) => {
  const destination = join(dirname(path), name);

  if (destination === path) return;

  const result = await polaris().request("files.rename", {
    hostKey: place.hostKey,
    path,
    destination,
  });

  if (!result.ok) {
    failed(`Couldn't rename ${basename(path)}`, result.error.message);

    return;
  }

  // Open tabs of the file, or of anything under a renamed folder, follow it.
  void renameFile(place.hostKey, path, destination);
  patchExplorer(place.key, () => ({ focused: destination }));
  await Promise.all([relist(place, dirname(path)), relist(place, dirname(destination))]);
};

/** Ends the draft: creates or renames with the typed name, or keeps the draft open on a bad one. */
export const commitDraft = async (place: Place, name: string) => {
  const { draft } = explorerOf(place.key);
  const valid = validName(name);

  if (draft === null) return;

  if (valid === null) {
    // Nothing typed is a cancel; anything else the user fixes in place.
    if (name.trim() === "") cancelDraft(place.key);

    return;
  }

  cancelDraft(place.key);

  if (draft.kind === "create") await create(place, draft.dir, draft.entry, valid);
  else await rename(place, draft.path, valid);
};

export type DeleteOutcome = "done" | "confirm" | "failed";

/**
 * Moves `path` to the Host's trash, or deletes it for good once `permanent`
 * (the user confirmed). A Host without a trash answers "confirm".
 */
export const deleteEntry = async (
  place: Place,
  path: string,
  permanent: boolean,
  tabs: TabsView
): Promise<DeleteOutcome> => {
  const result = await polaris().request("files.delete", {
    hostKey: place.hostKey,
    path,
    permanent,
  });

  if (!result.ok) {
    if (result.error.code === "TrashUnavailable" && !permanent) return "confirm";
    failed(`Couldn't delete ${basename(path)}`, result.error.message);

    return "failed";
  }

  // A tab with unsaved edits stays: the editor offers to save it somewhere.
  for (const tab of tabs.tabs) {
    if (isUnder(tab.path, path) && !tab.dirty) closeTab(place.hostKey, place.workspaceId, tab.path);
  }

  await relist(place, dirname(path));

  return "done";
};

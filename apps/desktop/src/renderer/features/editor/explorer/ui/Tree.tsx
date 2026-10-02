/**
 * The Files tree: virtualized rows (DESIGN.md, Performance), the keyboard,
 * the row being created or renamed, and the right-click menu.
 */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@polaris/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, useRef, useState } from "react";
import { useApp } from "../../../../shell/hooks.ts";
import { cancelDraft, commitDraft, deleteEntry, type Place, startDraft } from "../data/actions.ts";
import { type Draft, patchExplorer, toggleFolder } from "../data/store.ts";
import type { EditorTabs } from "../editorSeam.tsx";
import { treeKey } from "../model/keys.ts";
import { basename, dirname, relative } from "../model/paths.ts";
import type { TreeRow as Row } from "../model/tree.ts";
import { ConfirmDelete } from "./ConfirmDelete.tsx";
import { DraftRow } from "./DraftRow.tsx";
import { TreeRow } from "./TreeRow.tsx";

/** Tree-row heights per density step (DESIGN.md, Density), for the virtualizer's sums. */
const ROW = { calm: 28, balanced: 24, compact: 22 } as const;

type Item =
  | { readonly kind: "row"; readonly row: Row }
  | {
      readonly kind: "draft";
      readonly draft: Draft;
      readonly depth: number;
      readonly row: Row | null;
    };

/** The rows with the draft spliced in: a new name under its folder, a rename in place. */
const itemsOf = (rows: ReadonlyArray<Row>, draft: Draft | null): ReadonlyArray<Item> => {
  const items: Array<Item> = rows.map((row) => ({ kind: "row", row }));

  if (draft === null) return items;

  if (draft.kind === "rename") {
    const at = rows.findIndex((r) => r.path === draft.path);

    if (at >= 0) items[at] = { kind: "draft", draft, depth: rows[at]!.depth, row: rows[at]! };

    return items;
  }

  const parent = rows.findIndex((r) => r.kind === "folder" && r.path === draft.dir);

  items.splice(parent + 1, 0, {
    kind: "draft",
    draft,
    depth: parent < 0 ? 0 : rows[parent]!.depth + 1,
    row: null,
  });

  return items;
};

export interface TreeProps {
  readonly place: Place;
  readonly rows: ReadonlyArray<Row>;
  readonly draft: Draft | null;
  readonly focused: string | null;
  readonly tabs: EditorTabs;
  readonly hostLabel: string;
  readonly canManage: boolean;
  readonly onOpen: (path: string, pin: boolean) => void;
}

/** The folder a new entry goes in from a row: the folder itself, or a file's folder. */
const folderFor = (row: Row | undefined, root: string) =>
  row === undefined ? root : row.kind === "folder" ? row.path : dirname(row.path);

const copy = (text: string) => void navigator.clipboard?.writeText(text);

export const Tree = ({
  place,
  rows,
  draft,
  focused,
  tabs,
  hostLabel,
  canManage,
  onOpen,
}: TreeProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const density = useApp((s) => s.density);
  const [confirming, setConfirming] = useState<string | null>(null);
  const items = itemsOf(rows, draft);
  const target = rows.find((r) => r.path === focused);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW[density],
    getItemKey: (index) => {
      const item = items[index];

      return item?.kind === "row" ? item.row.path : `draft:${index}`;
    },
    overscan: 12,
  });

  const focusRow = (path: string) => {
    patchExplorer(place.key, () => ({ focused: path }));
    const at = rows.findIndex((r) => r.path === path);

    if (at >= 0) virtualizer.scrollToIndex(at, { align: "auto" });
    requestAnimationFrame(() =>
      scrollRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus()
    );
  };

  const activate = (row: Row, pin: boolean) => {
    if (row.kind === "file") {
      if (!row.deleted) onOpen(row.path, pin);
    } else if (!pin) {
      toggleFolder(place.key, row.toggle);
    }
  };

  const remove = async (path: string, permanent: boolean) => {
    const outcome = await deleteEntry(place, path, permanent, tabs);

    if (outcome === "confirm") setConfirming(path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: Row) => {
    const action = treeKey({ key: event.key, meta: event.metaKey }, rows, row.path);

    if (action === null) return;
    event.preventDefault();

    if (action.kind === "focus") focusRow(action.path);
    else if (action.kind === "toggle") toggleFolder(place.key, action.row.toggle, action.open);
    else if (action.kind === "open") onOpen(action.row.path, true);
    else if (canManage && action.kind === "rename")
      startDraft(place.key, { kind: "rename", path: action.row.path });
    else if (canManage && action.kind === "delete") void remove(action.row.path, false);
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={scrollRef}
            role="tree"
            aria-label="Files"
            data-testid="explorer-tree"
            className="min-h-0 flex-1 overflow-y-auto px-2"
            onContextMenu={(event) => {
              // Right-clicking past the rows acts on the Workspace's folder, not the last row.
              if (
                !(event.target instanceof Element) ||
                event.target.closest("[data-path]") === null
              ) {
                patchExplorer(place.key, () => ({ focused: null }));
              }
            }}
          >
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((v) => {
                const item = items[v.index]!;

                const style = {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${v.start}px)`,
                } as const;

                if (item.kind === "draft") {
                  return (
                    <DraftRow
                      key={v.key}
                      style={style}
                      depth={item.depth}
                      folder={
                        item.draft.kind === "create"
                          ? item.draft.entry === "directory"
                          : item.row?.kind === "folder"
                      }
                      initial={item.row === null ? "" : basename(item.row.path)}
                      label={item.draft.kind === "rename" ? "New name" : "Name"}
                      onCommit={(name) => void commitDraft(place, name)}
                      onCancel={() => cancelDraft(place.key)}
                    />
                  );
                }

                return (
                  <TreeRow
                    key={v.key}
                    style={style}
                    row={item.row}
                    selected={item.row.path === tabs.active}
                    focused={item.row.path === (focused ?? rows[0]?.path)}
                    onActivate={activate}
                    onFocusRow={(row) => patchExplorer(place.key, () => ({ focused: row.path }))}
                    onKeyDown={onKeyDown}
                  />
                );
              })}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={!canManage}
            onSelect={() =>
              startDraft(place.key, {
                kind: "create",
                dir: folderFor(target, place.root),
                entry: "file",
              })
            }
          >
            New file
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!canManage}
            onSelect={() =>
              startDraft(place.key, {
                kind: "create",
                dir: folderFor(target, place.root),
                entry: "directory",
              })
            }
          >
            New folder
          </ContextMenuItem>
          {target === undefined ? null : (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                disabled={!canManage || target.deleted}
                onSelect={() => startDraft(place.key, { kind: "rename", path: target.path })}
              >
                Rename
                <ContextMenuShortcut>F2</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem
                disabled={!canManage || target.deleted}
                onSelect={() => void remove(target.path, false)}
              >
                Delete
                <ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => copy(target.path)}>Copy path</ContextMenuItem>
              <ContextMenuItem onSelect={() => copy(relative(target.path, place.root))}>
                Copy relative path
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <ConfirmDelete
        path={confirming}
        host={hostLabel}
        onCancel={() => setConfirming(null)}
        onConfirm={(path) => {
          setConfirming(null);
          void remove(path, true);
        }}
      />
    </>
  );
};

/**
 * The diff: one Pierre `CodeView` over every file of the Review, in imperative mode (items
 * appended batch by batch as they parse, updated in place, replaced only when files move),
 * highlighted in the worker pool with our theme, flagged lines marked by `marksCss`.
 */
import type {
  CodeViewItem,
  File,
  FileDiff,
  DiffLineAnnotation,
  FileDiffContentsLoader,
  PostRenderPhase,
  SelectedLineRange,
} from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { useEffect, useMemo, useRef } from "react";
import { useStore } from "zustand";
import type { ReviewAnnotation } from "../surface.ts";
import { revealStore } from "../surface.ts";
import type { FindingInfo } from "../model/findings.ts";
import { THEMES } from "../model/theme.ts";
import { MAX_LINE_LENGTH } from "../data/pierre.tsx";
import { FileHeader } from "./FileHeader.tsx";
import { FindingRow } from "./FindingRow.tsx";
import "./diff.css";

/** What an annotation row under a line holds. */
export type RowMeta =
  | { readonly kind: "finding"; readonly finding: FindingInfo }
  | { readonly kind: "slot"; readonly annotation: ReviewAnnotation };

export type DiffItem = CodeViewItem<RowMeta>;

/** An item and what its rendering depends on (a change bumps its version). */
export interface PaneItem {
  readonly item: DiffItem;
  readonly signature: string;
  /** Its file's path, for revealing a line. */
  readonly path: string;
}

/** The page shows between files; each file's code sits in a card under its header (Paper R1). */
const BASE_CSS = `[data-diffs-header][data-sticky] { background-color: var(--color-bg); }
[data-diff] { border: 1px solid var(--color-hairline); border-top: 0; border-radius: 0 0 10px 10px; overflow: clip; }
[data-gutter] { padding-left: 14px; }`;

export interface DiffPaneProps {
  readonly items: ReadonlyArray<PaneItem>;
  readonly marksCss: string;
  readonly themeType: "light" | "dark";
  readonly loadDiffFiles: FileDiffContentsLoader;
  readonly onSelect: (id: string, range: SelectedLineRange | null) => void;
  /** Item keys by item id, set on each file's host element for `marksCss`. */
  readonly itemKeys: ReadonlyMap<string, string>;
}

type Handle = CodeViewHandle<RowMeta, undefined>;

/** The item a CodeView callback is about (its last argument). */
interface ItemContext {
  readonly item: { readonly id: string };
}

interface Synced {
  order: Array<string>;
  signatures: Map<string, string>;
  versions: Map<string, number>;
}

const withVersion = (synced: Synced, pane: PaneItem): DiffItem => {
  const version = (synced.versions.get(pane.item.id) ?? 0) + 1;

  synced.versions.set(pane.item.id, version);
  synced.signatures.set(pane.item.id, pane.signature);

  return { ...pane.item, version };
};

/** Brings Pierre's items to `items`: appends when they only grew, else replaces them. */
const sync = (handle: Handle, synced: Synced, items: ReadonlyArray<PaneItem>) => {
  const grew = synced.order.every((id, i) => items[i]?.item.id === id);

  if (!grew) {
    synced.order = items.map((p) => p.item.id);
    handle.getInstance()?.setItems(items.map((p) => withVersion(synced, p)));

    return;
  }

  for (const pane of items.slice(0, synced.order.length)) {
    if (synced.signatures.get(pane.item.id) !== pane.signature) {
      handle.updateItem(withVersion(synced, pane));
    }
  }

  const added = items.slice(synced.order.length);

  if (added.length > 0) {
    synced.order = items.map((p) => p.item.id);
    handle.addItems(added.map((p) => withVersion(synced, p)));
  }
};

const Annotation = ({ meta }: { readonly meta: RowMeta }) =>
  meta.kind === "finding" ? <FindingRow finding={meta.finding} /> : meta.annotation.render();

export const DiffPane = ({
  items,
  marksCss,
  themeType,
  loadDiffFiles,
  onSelect,
  itemKeys,
}: DiffPaneProps) => {
  const handle = useRef<Handle>(null);
  const synced = useRef<Synced>({ order: [], signatures: new Map(), versions: new Map() });
  const keys = useRef(itemKeys);
  const reveal = useStore(revealStore, (s) => s.request);

  useEffect(() => {
    keys.current = itemKeys;
  }, [itemKeys]);

  useEffect(() => {
    if (handle.current !== null) sync(handle.current, synced.current, items);
  }, [items]);

  useEffect(() => {
    if (reveal === null || handle.current === null) return;

    const target = items.find((p) => p.path === reveal.path);

    if (target === undefined) return;
    handle.current.scrollTo({
      type: "line",
      id: target.item.id,
      lineNumber: reveal.line,
      side: reveal.side === "old" ? "deletions" : "additions",
      align: "center",
      behavior: "smooth-auto",
    });
  }, [reveal, items]);

  const options = useMemo(
    () => ({
      theme: THEMES,
      themeType,
      diffStyle: "unified" as const,
      diffIndicators: "classic" as const,
      lineDiffType: "word-alt" as const,
      maxLineDiffLength: MAX_LINE_LENGTH,
      tokenizeMaxLineLength: MAX_LINE_LENGTH,
      overflow: "scroll" as const,
      stickyHeaders: true,
      hunkSeparators: "line-info" as const,
      enableLineSelection: true,
      enableGutterUtility: true,
      lineHoverHighlight: "both" as const,
      unsafeCSS: `${BASE_CSS}\n${marksCss}`,
      loadDiffFiles,
      itemMetrics: { diffHeaderHeight: 40 },
      layout: { paddingTop: 16, paddingBottom: 24, gap: 12 },
      onPostRender: (
        element: HTMLElement,
        _instance: FileDiff<RowMeta, undefined> | File<RowMeta, undefined>,
        _phase: PostRenderPhase,
        context: ItemContext
      ) => {
        const key = keys.current.get(context.item.id);

        if (key !== undefined && element.dataset.reviewItem !== key)
          element.dataset.reviewItem = key;
      },
      onLineSelectionEnd: (range: SelectedLineRange | null, context: ItemContext) =>
        onSelect(context.item.id, range),
    }),
    [themeType, marksCss, loadDiffFiles, onSelect]
  );

  return (
    <CodeView<RowMeta, undefined>
      ref={handle}
      initialItems={[]}
      options={options}
      className="review-diff px-panel min-h-0 flex-1 overflow-auto"
      renderCustomHeader={(item) => <FileHeader id={item.id} />}
      renderAnnotation={(
        annotation: DiffLineAnnotation<RowMeta> | { readonly metadata: RowMeta }
      ) => <Annotation meta={annotation.metadata} />}
    />
  );
};

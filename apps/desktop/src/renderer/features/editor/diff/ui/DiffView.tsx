/**
 * One file's diff in Pierre's `CodeView`, on Review's theme, tokens and worker pool
 * (features/diffs): unified or split, unchanged runs folded with expand, and in a
 * syntax-aware diff the changed tokens marked by highlights (emphasis.ts).
 */
import type { CodeViewItem } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { reducedMotion } from "@polaris/ui";
import { type Ref, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { DIFF_CLASS, MAX_LINE_LENGTH, THEMES } from "../../../diffs/index.ts";
import type { ComposedDiff } from "../data/compose.ts";
import type { DiffStyle } from "../model/prefs.ts";
import type { Stop } from "../model/stops.ts";
import {
  applyEmphasis,
  clearEmphasis,
  indexEmphasis,
  insertedCss,
  SYNTAX_CSS,
} from "./emphasis.ts";

/** The code sits in a card, as in Review, without a file header: the toolbar names the file. */
const BASE_CSS = `[data-diff] { border: 1px solid var(--color-hairline); border-radius: 10px; overflow: clip; }
[data-gutter] { padding-left: 14px; }
[data-separator-content] { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-subtle); }`;

export interface DiffViewHandle {
  readonly reveal: (stop: Stop) => void;
}

export interface DiffViewProps {
  readonly composed: ComposedDiff;
  readonly style: DiffStyle;
  readonly themeType: "light" | "dark";
  readonly handle: Ref<DiffViewHandle>;
}

type Handle = CodeViewHandle<undefined, undefined>;

const ITEM = "diff";

/** Pierre's file hosts: each draws its rows in its own shadow root. */
const shadowRoots = (container: HTMLElement | null): Array<ShadowRoot> =>
  container === null
    ? []
    : [...container.querySelectorAll("diffs-container")].flatMap((host) =>
        host.shadowRoot === null ? [] : [host.shadowRoot]
      );

/** Marks the drawn rows once per frame however often Pierre draws or the view scrolls. */
const useEmphasis = (composed: ComposedDiff, container: { current: HTMLDivElement | null }) => {
  const index = useMemo(() => indexEmphasis(composed.emphasis), [composed.emphasis]);
  const frame = useRef(0);

  const schedule = useMemo(
    () => () => {
      if (index.size === 0 || frame.current !== 0) return;

      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        applyEmphasis(shadowRoots(container.current), index);
      });
    },
    [index, container]
  );

  useEffect(() => {
    clearEmphasis();
    schedule();

    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      clearEmphasis();
    };
  }, [schedule]);

  return schedule;
};

let version = 0;

export const DiffView = ({ composed, style, themeType, handle }: DiffViewProps) => {
  const view = useRef<Handle>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const mark = useEmphasis(composed, container);

  const items = useMemo(
    (): ReadonlyArray<CodeViewItem<undefined>> => [
      { id: ITEM, type: "diff", fileDiff: composed.diff, version: ++version },
    ],
    [composed.diff]
  );

  useImperativeHandle(
    handle,
    () => ({
      reveal: (stop) =>
        view.current?.scrollTo({
          type: "line",
          id: ITEM,
          lineNumber: stop.line,
          side: stop.side,
          align: "center",
          behavior: reducedMotion() ? "instant" : "smooth-auto",
        }),
    }),
    []
  );

  const options = useMemo(
    () => ({
      theme: THEMES,
      themeType,
      diffStyle: style,
      diffIndicators: "classic" as const,
      lineDiffType: composed.mode === "syntax" ? ("none" as const) : ("word-alt" as const),
      maxLineDiffLength: MAX_LINE_LENGTH,
      tokenizeMaxLineLength: MAX_LINE_LENGTH,
      overflow: "scroll" as const,
      disableFileHeader: true,
      hunkSeparators: "line-info" as const,
      lineHoverHighlight: "both" as const,
      unsafeCSS: [
        BASE_CSS,
        composed.mode === "syntax" ? SYNTAX_CSS : "",
        insertedCss(composed.inserted),
      ].join("\n"),
      layout: { paddingTop: 12, paddingBottom: 24, gap: 0 },
      onPostRender: mark,
    }),
    [themeType, style, composed.mode, composed.inserted, mark]
  );

  return (
    <CodeView<undefined, undefined>
      ref={view}
      containerRef={container}
      items={items}
      options={options}
      onScroll={mark}
      className={`${DIFF_CLASS} px-panel min-h-0 flex-1 overflow-auto`}
    />
  );
};

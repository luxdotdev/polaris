/**
 * The Origins card as a CodeMirror tooltip under the annotation, its text aligned with the
 * annotation's. Opened by hovering the annotation or ⌥B; any edit or cursor move closes it.
 */
import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import type { BlameCommit } from "@polaris/protocol";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { EditorFile } from "../api.ts";
import { basename } from "../explorer/model/paths.ts";
import { OriginsCard } from "./Card.tsx";
import type { Lookup } from "./data.ts";
import { openOriginCommit, openOriginSession } from "./navigate.ts";

export interface CardSpec {
  /** The end of the cursor's line, where the annotation starts. */
  readonly pos: number;
  readonly file: EditorFile;
  readonly line: number;
  readonly commit: BlameCommit | null;
  /** The file's path in the commit, from blame (before a later rename). */
  readonly path: string;
  readonly root: string;
  readonly lookup: Lookup | null;
  readonly focus: boolean;
}

export const openCard = StateEffect.define<CardSpec>();

export const closeCard = StateEffect.define<null>();

/** The annotation starts 24px after the code; the card's text 16px into it. */
const OFFSET_X = 8;

const mount = (view: EditorView, spec: CardSpec) => {
  const dom = document.createElement("div");
  const root = createRoot(dom);

  const close = () => {
    view.dispatch({ effects: closeCard.of(null) });
    view.focus();
  };

  dom.className = "cm-originsCard";
  dom.addEventListener("mouseenter", () => hovering.set(view, true));
  dom.addEventListener("mouseleave", () => {
    hovering.set(view, false);
    leave(view);
  });
  flushSync(() =>
    root.render(
      <OriginsCard
        line={spec.line}
        fileName={basename(spec.file.path)}
        commit={spec.commit}
        lookup={spec.lookup}
        now={Date.now()}
        focusFirst={spec.focus}
        onClose={close}
        onOpenSession={(line) => {
          close();
          openOriginSession(line);
        }}
        onOpenCommit={(commit) => {
          close();
          openOriginCommit(spec.file, commit, spec.path, spec.root);
        }}
      />
    )
  );

  return {
    dom,
    offset: { x: OFFSET_X, y: 4 },
    destroy: () => queueMicrotask(() => root.unmount()),
  };
};

const tooltipOf = (spec: CardSpec): Tooltip => ({
  pos: spec.pos,
  above: false,
  create: (view) => mount(view, spec),
});

export const cardField = StateField.define<CardSpec | null>({
  create: () => null,
  update(value, tr) {
    let next = tr.docChanged || tr.selection !== undefined ? null : value;

    for (const effect of tr.effects) {
      if (effect.is(openCard)) next = effect.value;
      else if (effect.is(closeCard)) next = null;
    }

    return next;
  },
  provide: (field) => showTooltip.from(field, (spec) => (spec === null ? null : tooltipOf(spec))),
});

/** Whether the pointer is over the card, per view: leaving the annotation onto it keeps it open. */
const hovering = new WeakMap<EditorView, boolean>();

const leaving = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();

/** The pointer has this long to cross from the annotation to the card. */
const GRACE_MS = 200;

/** The pointer left the annotation or the card: the card closes unless it comes back. */
export const leave = (view: EditorView) => {
  clearTimeout(leaving.get(view));
  leaving.set(
    view,
    setTimeout(() => {
      leaving.delete(view);

      if (hovering.get(view) !== true && view.state.field(cardField, false))
        view.dispatch({ effects: closeCard.of(null) });
    }, GRACE_MS)
  );
};

/** The pointer is back over the annotation: a pending close is off. */
export const stay = (view: EditorView) => clearTimeout(leaving.get(view));

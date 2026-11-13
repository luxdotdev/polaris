/**
 * Inline blame with Origins (DESIGN.md, Origins; ADR 0111): once the cursor settles, its line
 * alone is blamed on the file's Host and asked of every connected Host; nothing runs while idle.
 */
import { type Extension, StateEffect } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { BlameCommit } from "@polaris/protocol";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { showsDiagnosticAt } from "../cm/inlineDiagnostics.ts";
import { editorFile } from "../cm/extensions.ts";
import { explorerKey, explorerOf, subscribeExplorers } from "../explorer/data/store.ts";
import { fileKey } from "../model/drafts.ts";
import { modelOf } from "../runtime/store.ts";
import { Annotation } from "./Annotation.tsx";
import { cardField, type CardSpec, leave, openCard, stay } from "./cardTooltip.tsx";
import { blameLine, checkoutOf, type Lookup, lookupOrigins } from "./data.ts";
import { DiskLines } from "./diskLines.ts";

/** The cursor rests this long before its line is blamed. */
const SETTLE_MS = 150;

/** Hovering the annotation this long opens the card. */
const HOVER_MS = 300;

/** What the annotation shows for the cursor's line. */
interface Shown {
  readonly spec: CardSpec;
}

const refresh = StateEffect.define<null>();

let enabled = true;

const views = new Set<EditorView>();

/** Settings → Editor → Inline blame, and its command: shows or hides it in every editor. */
export const setInlineBlame = (on: boolean) => {
  if (on === enabled) return;
  enabled = on;

  for (const view of views) view.plugin(originsPlugin)?.reset();
};

class AnnotationWidget extends WidgetType {
  root: Root | null = null;

  constructor(
    readonly line: number,
    readonly commit: BlameCommit | null,
    readonly lookup: Lookup | null
  ) {
    super();
  }

  override eq(other: AnnotationWidget) {
    return (
      other.line === this.line &&
      other.commit?.sha === this.commit?.sha &&
      other.lookup === this.lookup
    );
  }

  toDOM(view: EditorView) {
    const dom = document.createElement("span");

    dom.className = "cm-originAnnotation";
    dom.setAttribute("aria-hidden", "true");
    dom.addEventListener("mouseenter", () => view.plugin(originsPlugin)?.hoverStart());
    dom.addEventListener("mouseleave", () => view.plugin(originsPlugin)?.hoverEnd());
    this.root = createRoot(dom);
    const props = { line: this.line, commit: this.commit, lookup: this.lookup, now: Date.now() };

    flushSync(() => this.root?.render(<Annotation {...props} />));

    return dom;
  }

  override destroy() {
    const { root } = this;

    queueMicrotask(() => root?.unmount());
  }

  override ignoreEvent() {
    return true;
  }
}

const headOf = (view: EditorView) => {
  const file = view.state.facet(editorFile);
  const git = file === null ? null : explorerOf(explorerKey(file.hostKey, file.workspaceId)).git;

  return git === null || git === "none" ? "" : (git.head ?? "");
};

const originsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    shown: Shown | null = null;
    settle: ReturnType<typeof setTimeout> | null = null;
    hover: ReturnType<typeof setTimeout> | null = null;
    /** Each blame asked; an answer for an older one is dropped. */
    asked = 0;
    head: string;
    readonly disk: DiskLines;
    readonly unsubscribe: () => void;

    constructor(readonly view: EditorView) {
      views.add(view);
      this.disk = new DiskLines(view.state.doc);
      this.head = headOf(view);
      this.disk.sync(this.version() ?? "", view.state.doc);
      this.unsubscribe = subscribeExplorers(() => {
        const head = headOf(view);

        if (head === this.head) return;
        this.head = head;
        this.reset();
      });
      this.schedule();
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.disk.edit(update.changes);

      if (update.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))) this.redraw();

      if (!update.docChanged && !update.selectionSet) return;
      const line = (state = update.state) => state.doc.lineAt(state.selection.main.head).number;

      if (update.docChanged || line(update.startState) !== line()) this.hide();
      this.schedule();
    }

    /** Drops what is shown and asks again for the cursor's line. */
    reset() {
      this.hide();
      this.view.dispatch({ effects: refresh.of(null) });
      this.schedule();
    }

    /** Called in an update, or before a dispatch that repaints. */
    hide() {
      this.asked++;
      this.shown = null;
      this.decorations = Decoration.none;
    }

    schedule() {
      if (this.settle !== null) clearTimeout(this.settle);
      this.settle = enabled
        ? setTimeout(() => {
            this.settle = null;
            void this.blame();
          }, SETTLE_MS)
        : null;
    }

    /** The disk text's version and HEAD: a save, a reload or a commit asks git again. */
    version() {
      const file = this.view.state.facet(editorFile);
      const model = file === null ? null : modelOf(fileKey(file.hostKey, file.path));

      return model === null ? null : `${JSON.stringify(model.version)}\u0000${this.head}`;
    }

    async blame() {
      const { state } = this.view;
      const file = state.facet(editorFile);
      const checkout = file === null ? null : checkoutOf(file);
      const model = file === null ? null : modelOf(fileKey(file.hostKey, file.path));
      const version = this.version();

      if (file === null || checkout === null || model === null || version === null) return;
      const asked = ++this.asked;
      const line = state.doc.lineAt(state.selection.main.head);
      const base = { pos: line.to, file, line: line.number, root: checkout.root, focus: false };

      this.disk.sync(version, state.doc);

      if (this.disk.edited(line.from, line.to)) {
        this.show({ ...base, commit: null, path: file.path, lookup: null });

        return;
      }

      const diskLine = this.disk.lineOf(line.from, model.dirty);
      const blamed = diskLine === null ? null : await blameLine(file, diskLine, version);

      if (blamed === null || asked !== this.asked) return;
      const { commit, path, hash } = blamed.line;

      const query = {
        line: diskLine ?? line.number,
        path,
        hash,
        commitSha: commit?.sha ?? null,
        commitTime: commit?.time ?? null,
      };

      const lookup = lookupOrigins(blamed.repoKey, query, version);

      this.show({ ...base, line: query.line, commit, path, lookup });
    }

    show(spec: CardSpec) {
      this.shown = { spec };
      this.view.dispatch({ effects: refresh.of(null) });
    }

    redraw() {
      const spec = this.shown?.spec;
      const at = spec === undefined ? null : this.view.state.doc.lineAt(spec.pos);

      this.decorations =
        spec === undefined || at === null || !enabled || showsDiagnosticAt(this.view.state, at.from)
          ? Decoration.none
          : Decoration.set(
              Decoration.widget({
                widget: new AnnotationWidget(spec.line, spec.commit, spec.lookup),
                side: 1,
              }).range(at.to)
            );
    }

    hoverStart() {
      stay(this.view);

      if (this.hover !== null) clearTimeout(this.hover);
      this.hover = setTimeout(() => {
        this.hover = null;
        this.openCard(false);
      }, HOVER_MS);
    }

    hoverEnd() {
      if (this.hover !== null) clearTimeout(this.hover);
      this.hover = null;
      leave(this.view);
    }

    openCard(focus: boolean) {
      const spec = this.shown?.spec;

      if (spec === undefined || this.decorations.size === 0) return false;
      this.view.dispatch({ effects: openCard.of({ ...spec, focus }) });

      return true;
    }

    destroy() {
      views.delete(this.view);
      this.unsubscribe();

      if (this.settle !== null) clearTimeout(this.settle);

      if (this.hover !== null) clearTimeout(this.hover);
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

const v = (token: string) => `var(--color-${token})`;

const theme = EditorView.theme({
  ".cm-originAnnotation": {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    marginLeft: "24px",
    verticalAlign: "top",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-caption)",
    color: v("text-subtle"),
    whiteSpace: "nowrap",
    userSelect: "none",
    cursor: "default",
  },
  ".cm-originDot": { color: v("text-faint") },
  ".cm-originBodies": { display: "inline-flex" },
  ".cm-originBodies > * + *": { marginLeft: "-4px" },
  ".cm-originTitle": { maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis" },
  ".cm-tooltip:has(> .cm-originsCard)": { background: "none", border: "none" },
});

/** The cursor line's blame and Origins, its hover card, and ⌥B to open the card from the keys. */
export const inlineBlame: Extension = [
  originsPlugin,
  cardField,
  keymap.of([
    {
      key: "Alt-b",
      run: (view) => view.plugin(originsPlugin)?.openCard(true) ?? false,
    },
  ]),
  theme,
];

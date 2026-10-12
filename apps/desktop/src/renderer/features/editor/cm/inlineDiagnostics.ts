/**
 * Inline diagnostics (DESIGN.md, Editor: Diagnostics; Paper 17, 17b): one gutter mark per line
 * for its most severe diagnostic, and that diagnostic's message at the end of the line.
 */
import { completionStatus } from "@codemirror/autocomplete";
import { type Diagnostic, setDiagnosticsEffect } from "@codemirror/lint";
import {
  type EditorState,
  type Extension,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  gutter,
  GutterMarker,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

export type Severity = Diagnostic["severity"];

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2, hint: 3 };

/** A line's most severe diagnostic, and how many others (hints aside) share the line. */
export class LineDiagnostic extends GutterMarker {
  constructor(
    readonly severity: Severity,
    readonly message: string,
    readonly more: number
  ) {
    super();
  }

  override eq(other: LineDiagnostic) {
    return (
      other.severity === this.severity && other.message === this.message && other.more === this.more
    );
  }

  override toDOM() {
    const mark = document.createElement("span");
    mark.className = `cm-diagnosticMark cm-diagnosticMark-${this.severity}`;
    mark.setAttribute("aria-hidden", "true");

    return mark;
  }
}

const firstLine = (message: string) => message.trimStart().split("\n", 1)[0]?.trimEnd() ?? "";

const lineOf = (doc: Text, diagnostic: Diagnostic) =>
  doc.lineAt(Math.max(0, Math.min(diagnostic.from, doc.length)));

/** Groups diagnostics by the line they start on, most severe first. */
export const summarise = (doc: Text, diagnostics: readonly Diagnostic[]) => {
  const lines = new Map<number, Diagnostic[]>();

  for (const diagnostic of diagnostics) {
    const from = lineOf(doc, diagnostic).from;
    lines.set(from, [...(lines.get(from) ?? []), diagnostic]);
  }

  return RangeSet.of(
    [...lines].map(([from, items]) => {
      const sorted = items.toSorted((a, b) => RANK[a.severity] - RANK[b.severity]);
      const [top] = sorted;
      // SAFETY: every entry in `lines` was created with at least one diagnostic.
      const head = top as Diagnostic;
      const more = sorted.slice(1).filter((item) => item.severity !== "hint").length;

      return new LineDiagnostic(head.severity, firstLine(head.message), more).range(from);
    }),
    true
  );
};

export const lineDiagnostics = StateField.define<RangeSet<LineDiagnostic>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    let next = tr.docChanged ? value.map(tr.changes) : value;

    for (const effect of tr.effects)
      if (effect.is(setDiagnosticsEffect)) next = summarise(tr.state.doc, effect.value);

    return next;
  },
});

class MessageWidget extends WidgetType {
  constructor(readonly line: LineDiagnostic) {
    super();
  }

  override eq(other: MessageWidget) {
    return other.line.eq(this.line);
  }

  override toDOM() {
    const wrap = document.createElement("span");
    wrap.className = `cm-inlineDiagnostic cm-inlineDiagnostic-${this.line.severity}`;
    wrap.setAttribute("aria-hidden", "true");
    const message = document.createElement("span");
    message.className = "cm-inlineDiagnostic-message";
    message.textContent = this.line.message;
    wrap.append(message);

    if (this.line.more > 0) {
      const more = document.createElement("span");
      more.className = "cm-inlineDiagnostic-more";
      more.textContent = `+${this.line.more}`;
      wrap.append(more);
    }

    return wrap;
  }
}

let shown = true;

const views = new Set<EditorView>();

const refresh = StateEffect.define<null>();

/** Settings → Editor → Inline diagnostics: shows or hides the messages in every open editor. */
export const setInlineDiagnostics = (on: boolean) => {
  if (on === shown) return;
  shown = on;

  for (const view of views) view.dispatch({ effects: refresh.of(null) });
};

/** The cursor line while the completion popup is up: its message would sit under the popup. */
const heldLine = (state: EditorState): number | null =>
  completionStatus(state) === null ? null : state.doc.lineAt(state.selection.main.head).from;

const addMessages = (view: EditorView, builder: RangeSetBuilder<Decoration>) => {
  const held = heldLine(view.state);
  const field = view.state.field(lineDiagnostics);

  let last = -1;

  for (const { from, to } of view.visibleRanges) {
    field.between(from, to, (start, _end, line) => {
      if (start <= last || line.severity === "hint" || start === held) return;
      last = start;
      const end = view.state.doc.lineAt(start).to;
      builder.add(end, end, Decoration.widget({ widget: new MessageWidget(line), side: 1 }));
    });
  }
};

const messages = (view: EditorView): DecorationSet => {
  if (!shown) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  addMessages(view, builder);

  return builder.finish();
};

const stale = (update: ViewUpdate) =>
  update.docChanged ||
  update.viewportChanged ||
  update.startState.field(lineDiagnostics) !== update.state.field(lineDiagnostics) ||
  heldLine(update.startState) !== heldLine(update.state) ||
  update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refresh)));

/** Narrower than this, a message would read as a stub, so it hides. */
const MIN_ROOM = 64;

/** Fits each message to the room left of the visible code, so it never widens the line. */
const fit = (view: EditorView) =>
  view.requestMeasure({
    key: fit,
    read: () => {
      const right = view.scrollDOM.getBoundingClientRect().right - 16;

      return [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-inlineDiagnostic")].map(
        (node) => ({ node, room: right - node.getBoundingClientRect().left })
      );
    },
    write: (rooms) => {
      for (const { node, room } of rooms) {
        node.style.setProperty("--room", `${Math.floor(room)}px`);
        node.style.visibility = room < MIN_ROOM ? "hidden" : "";
      }
    },
  });

const messagePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(readonly view: EditorView) {
      views.add(view);
      this.decorations = messages(view);
      fit(view);
    }

    update(update: ViewUpdate) {
      if (stale(update)) this.decorations = messages(update.view);

      if (stale(update) || update.geometryChanged) fit(update.view);
    }

    destroy() {
      views.delete(this.view);
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      scroll() {
        fit(this.view);
      },
    },
  }
);

const marks = gutter({
  class: "cm-diagnosticGutter",
  markers: (view) => view.state.field(lineDiagnostics),
});

const v = (token: string) => `var(--color-${token})`;

/** The mark's shape carries the severity as well as its hue (DESIGN.md, Editor: Diagnostics). */
const inlineTheme = EditorView.theme({
  ".cm-gutter.cm-diagnosticGutter": { width: "20px", marginLeft: "-20px" },
  ".cm-diagnosticGutter .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  ".cm-diagnosticMark": { display: "block", boxSizing: "border-box", borderRadius: "999px" },
  ".cm-diagnosticMark-error": { width: "7px", height: "7px", backgroundColor: v("failed") },
  ".cm-diagnosticMark-warning": {
    width: "9px",
    height: "8px",
    borderRadius: "0",
    backgroundColor: v("diagnostic-warning"),
    clipPath: "polygon(50% 0, 100% 100%, 0 100%)",
  },
  ".cm-diagnosticMark-info": {
    width: "7px",
    height: "7px",
    border: `1.25px solid ${v("text-subtle")}`,
  },
  ".cm-diagnosticMark-hint": {
    width: "5px",
    height: "5px",
    border: `1.25px solid ${v("text-faint")}`,
  },
  ".cm-inlineDiagnostic": {
    display: "inline-flex",
    gap: "8px",
    // Until measured, no room at all, so a message never widens the line for a frame.
    maxWidth: "min(72ch, var(--room, 0px))",
    marginLeft: "24px",
    overflow: "hidden",
    verticalAlign: "top",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-caption)",
    pointerEvents: "none",
    userSelect: "none",
  },
  ".cm-inlineDiagnostic-message": {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "pre",
  },
  ".cm-inlineDiagnostic-error": { color: v("failed-text") },
  ".cm-inlineDiagnostic-warning": { color: v("diagnostic-warning-text") },
  ".cm-inlineDiagnostic-info": { color: v("text-subtle") },
  ".cm-inlineDiagnostic-more": { color: v("text-faint"), flexShrink: 0 },
});

/** After the line numbers, so the mark sits between the number and the code. */
export const inlineDiagnostics: Extension = [lineDiagnostics, marks, messagePlugin, inlineTheme];

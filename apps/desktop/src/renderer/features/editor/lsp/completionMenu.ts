/**
 * The completion menu's language-server parts (DESIGN.md, Editor: Completion): a kind
 * icon per row, and the answering server as one footnote under the list, never in a row.
 */
import { type Completion, completionStatus, currentCompletions } from "@codemirror/autocomplete";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";

/** LSP `CompletionItemKind` to the CodeMirror type that picks the row's icon. */
const KINDS = new Map<number, string>([
  [1, "text"],
  [2, "method"],
  [3, "function"],
  [4, "method"],
  [5, "property"],
  [6, "variable"],
  [7, "class"],
  [8, "interface"],
  [9, "namespace"],
  [10, "property"],
  [12, "constant"],
  [13, "enum"],
  [14, "keyword"],
  [15, "text"],
  [20, "enum"],
  [21, "constant"],
  [22, "class"],
  [24, "keyword"],
  [25, "type"],
]);

export const completionType = (kind: number | undefined): string =>
  (kind === undefined ? undefined : KINDS.get(kind)) ?? "text";

const providers = new WeakMap<Completion, string>();

/** Records which server offered `completion`, for the footnote. */
export const offeredBy = (completion: Completion, label: string): Completion => {
  providers.set(completion, label);

  return completion;
};

/** The distinct servers behind the open list, in the order they first appear. */
export const footnoteOf = (options: readonly Completion[]): string =>
  [...new Set(options.flatMap((option) => providers.get(option) ?? []))].join(", ");

const FOOTNOTE = "cm-completionFootnote";

const place = (view: EditorView) => {
  const tooltip = view.dom.querySelector(".cm-tooltip-autocomplete");

  if (!tooltip) return;
  const text = footnoteOf(currentCompletions(view.state));
  let footnote = tooltip.querySelector(`:scope > .${FOOTNOTE}`);

  if (!text) {
    footnote?.remove();

    return;
  }

  if (!footnote) {
    footnote = document.createElement("div");
    footnote.className = FOOTNOTE;
    footnote.setAttribute("data-completion-footnote", "");
    tooltip.append(footnote);
  }

  if (footnote.textContent !== text) footnote.textContent = text;
};

/** The list re-renders inside the tooltip, so the footnote is re-placed after each update. */
export const completionFootnote = ViewPlugin.define((view) => {
  const measure = { read: () => null, write: () => place(view), key: FOOTNOTE };

  return {
    update: (update: ViewUpdate) => {
      if (completionStatus(update.state) !== null) update.view.requestMeasure(measure);
    },
  };
});

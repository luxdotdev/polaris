import {
  type Completion,
  type CompletionSource,
  pickedCompletion,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { setDiagnostics } from "@codemirror/lint";
import type { ChangeSpec, Text } from "@codemirror/state";
import { hoverTooltip, ViewPlugin, type EditorView } from "@codemirror/view";
import { Predicate } from "effect";
import { LanguageDiagnosticFeed, cmDiagnostics } from "./diagnostics.ts";
import { LanguageFeatures } from "./features.ts";
import { completionItems, markupText, type CompletionItem } from "./payloads.ts";
import { offsetAt } from "./position.ts";
import type { LanguageBuffer, LanguageProvider } from "./types.ts";

export interface CompletionProposal {
  readonly provider: LanguageProvider;
  readonly buffer: LanguageBuffer;
  readonly item: CompletionItem;
  readonly from: number;
  readonly to: number;
}

/** E1 handles server commands and rich snippets with additional edits through this seam. */
export interface CompletionCoordinator {
  readonly propose: (proposal: CompletionProposal) => void;
}

const completionRange = (
  doc: Text,
  item: CompletionItem,
  provider: LanguageProvider,
  from: number,
  to: number
) => {
  const edit = item.textEdit;

  if (edit === undefined) return { from, to };
  const range = "range" in edit ? edit.range : edit.replace;

  return {
    from: offsetAt(doc, range.start, provider.capabilities.positionEncoding),
    to: offsetAt(doc, range.end, provider.capabilities.positionEncoding),
  };
};

const plainChanges = (proposal: CompletionProposal): ChangeSpec[] => {
  const { item, buffer, provider, from, to } = proposal;
  const primary = { from, to, insert: item.textEdit?.newText ?? item.insertText ?? item.label };

  const changes = [
    primary,
    ...(item.additionalTextEdits ?? []).map((edit) => ({
      from: offsetAt(buffer.doc, edit.range.start, provider.capabilities.positionEncoding),
      to: offsetAt(buffer.doc, edit.range.end, provider.capabilities.positionEncoding),
      insert: edit.newText,
    })),
  ].sort((left, right) => left.from - right.from);

  for (let index = 1; index < changes.length; index++) {
    const previous = changes[index - 1];
    const current = changes[index];

    if (previous && current && (previous.to > current.from || previous.from === current.from))
      throw new RangeError("Overlapping completion edits");
  }

  return changes;
};

/** Convert the supported LSP tabstop subset; transforms/choices/variables need E1's proposal path. */
export const cmSnippet = (value: string): string | null => {
  if (/\$\{[^}]*[|/]|\$[A-Za-z_]|\$\{[A-Za-z_]|\\|\$\{[^}]*\$/.test(value)) return null;

  return value.replace(
    /\$\{(\d+):([^}]*)\}|\$\{(\d+)\}|\$(\d+)/g,
    (
      _match,
      index: string | undefined,
      text: string | undefined,
      braced: string | undefined,
      bare: string | undefined
    ) => `\${${index ?? braced ?? bare}:${text ?? ""}}`
  );
};

const cmCompletion = (
  features: LanguageFeatures,
  proposal: CompletionProposal,
  coordinator: CompletionCoordinator
): Completion => {
  const { item, provider, buffer } = proposal;

  const base: Completion = {
    label: item.filterText ?? item.label,
    displayLabel: item.label,
    detail: `${provider.context.providerId}${item.detail ? ` · ${item.detail}` : ""}`,
  };

  if (item.sortText) base.sortText = item.sortText;

  if (item.documentation) base.info = markupText(item.documentation);

  const template =
    item.insertTextFormat === 2
      ? cmSnippet(item.textEdit?.newText ?? item.insertText ?? item.label)
      : null;

  const snippet = template === null ? null : snippetCompletion(template, base);

  return {
    ...base,
    apply: (view, completion) => {
      if (view.state.doc !== buffer.doc || !features.requests.current(provider, buffer)) return;

      if (
        item.command ||
        (item.insertTextFormat === 2 && (snippet === null || item.additionalTextEdits?.length))
      ) {
        coordinator.propose(proposal);

        return;
      }

      if (snippet && Predicate.isFunction(snippet.apply)) {
        snippet.apply(view, completion, proposal.from, proposal.to);

        return;
      }

      try {
        view.dispatch({
          changes: plainChanges(proposal),
          annotations: pickedCompletion.of(completion),
          userEvent: "input.complete",
        });
      } catch {
        coordinator.propose(proposal);
      }
    },
  };
};

export const completionSource =
  (features: LanguageFeatures, coordinator: CompletionCoordinator): CompletionSource =>
  async (context) => {
    const buffer = features.options.buffer();

    if (context.state.doc !== buffer.doc || context.aborted) return null;
    const word = context.matchBefore(/[\p{L}\p{N}_$]+/u);

    const preceding = context.state.doc.sliceString(Math.max(0, context.pos - 1), context.pos);

    const trigger = features.options
      .providers()
      .some((provider) => provider.completionTriggerCharacters?.includes(preceding))
      ? preceding
      : undefined;

    if (!word && !context.explicit && !trigger) return null;
    const controller = new AbortController();
    context.addEventListener("abort", () => controller.abort(), { onDocChange: true });
    const answers = await features.completion(context.pos, controller.signal, trigger);

    if (context.aborted || controller.signal.aborted) return null;
    const from = word?.from ?? context.pos;

    const options = answers
      .flatMap(({ provider, payload }) => {
        const items = completionItems(payload);

        return items.flatMap((item) => {
          try {
            const range = completionRange(buffer.doc, item, provider, from, context.pos);

            return [cmCompletion(features, { provider, buffer, item, ...range }, coordinator)];
          } catch {
            return [];
          }
        });
      })
      .slice(0, 2000);

    return options.length ? { from, to: context.pos, options } : null;
  };

/** Host-supplied content is rendered as text; E1 can replace rendering with the sanitized UI layer. */
export const hoverExtension = (features: LanguageFeatures) =>
  hoverTooltip(
    async (view, position) => {
      if (view.state.doc !== features.options.buffer().doc) return null;
      const answers = await features.hover(position);

      if (!answers.length || view.state.doc !== features.options.buffer().doc) return null;

      return {
        pos: position,
        create: () => {
          const dom = document.createElement("div");
          dom.setAttribute("role", "tooltip");

          for (const { provider, payload } of answers) {
            const section = dom.appendChild(document.createElement("div"));

            const content = !(Predicate.isString(payload.contents) || "value" in payload.contents)
              ? payload.contents.map(markupText).join("\n")
              : markupText(payload.contents);

            section.textContent = `${provider.context.providerId}\n${content}`;
          }

          return { dom };
        },
      };
    },
    { hideOnChange: true }
  );

/** Per-view feed only. E1 owns adapter disposal after every consuming view detaches. */
export const diagnosticsExtension = (features: LanguageFeatures) =>
  ViewPlugin.fromClass(
    class {
      readonly feed: LanguageDiagnosticFeed;
      private scheduled = false;
      constructor(readonly view: EditorView) {
        this.feed = new LanguageDiagnosticFeed(features.requests, () => {
          if (this.scheduled) return;
          this.scheduled = true;
          queueMicrotask(() => {
            this.scheduled = false;

            if (!this.closed)
              view.dispatch(
                setDiagnostics(view.state, cmDiagnostics(features.requests, this.feed.values()))
              );
          });
        });
        this.feed.refresh();
      }
      private closed = false;
      update(update: { docChanged: boolean }) {
        if (update.docChanged) {
          features.invalidate();
          this.feed.clear();
        }
      }
      destroy() {
        this.closed = true;
        this.feed.dispose();
      }
    }
  );

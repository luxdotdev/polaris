import {
  closeCompletion,
  type Completion,
  type CompletionSource,
  pickedCompletion,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { setDiagnostics } from "@codemirror/lint";
import type { ChangeSpec, Text } from "@codemirror/state";
import { hoverTooltip, ViewPlugin, type EditorView } from "@codemirror/view";
import type * as P from "@polaris/protocol";
import { Predicate } from "effect";
import { completionType, offeredBy } from "./completionMenu.ts";
import { completionResolver, SETTLE_MS, type CompletionResolver } from "./completionResolve.ts";
import { LanguageDiagnosticFeed, cmDiagnostics } from "./diagnostics.ts";
import { completionDocs, fenceLanguage, rowDetail } from "./docParts.ts";
import { loadDocRenderer, mountDocs } from "./docs.tsx";
import { LanguageFeatures } from "./features.ts";
import { completionItems, hoverParts, type CompletionItem } from "./payloads.ts";
import { offsetAt } from "./position.ts";
import type { LanguageBuffer, LanguageProvider } from "./types.ts";

export interface CompletionProposal {
  readonly request: P.LanguageFeatureRequest;
  readonly result: P.LanguageFeatureResult;
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

/** The info panel beside the selected row: the shared docs renderer, 360px wide. */
const completionInfo = (resolver: CompletionResolver, proposal: CompletionProposal) => async () => {
  const [full] = await Promise.all([resolver.item(), loadDocRenderer()]);
  const parts = completionDocs(full, fenceLanguage(proposal.buffer.uri));

  if (!parts.length) return null;
  const dom = document.createElement("div");

  return { dom, ...mountDocs(dom, { sections: [parts], variant: "panel" }) };
};

/** Rows show the server's label; a different filter text (tsserver's `.append`) maps matches back. */
const labelOffsets = new WeakMap<Completion, number>();

const getMatch = (completion: Completion, matched: readonly number[] = []) => {
  const offset = labelOffsets.get(completion);
  const length = completion.displayLabel?.length ?? completion.label.length;

  return offset === undefined
    ? matched
    : matched.map((at) => Math.min(length, Math.max(0, at - offset)));
};

const cmCompletion = (
  features: LanguageFeatures,
  proposal: CompletionProposal,
  coordinator: CompletionCoordinator
): Completion => {
  const { item, provider, buffer } = proposal;
  const resolver = completionResolver(features, proposal);

  const base: Completion = {
    label: item.filterText ?? item.label,
    type: completionType(item.kind),
    info: completionInfo(resolver, proposal),
  };

  if (item.filterText !== undefined && item.filterText !== item.label)
    base.displayLabel = item.label;

  const detail = rowDetail(item);

  if (detail) base.detail = detail;

  if (item.sortText) base.sortText = item.sortText;

  const template =
    item.insertTextFormat === 2
      ? cmSnippet(item.textEdit?.newText ?? item.insertText ?? item.label)
      : null;

  const snippet = template === null ? null : snippetCompletion(template, base);

  /** Applies `full`, the resolved item when it came in time, under the usual fence. */
  const accept = (view: EditorView, completion: Completion, full: CompletionItem) => {
    if (view.state.doc !== buffer.doc || !features.requests.current(provider, buffer)) return;
    const accepted = { ...proposal, item: full };

    if (
      full.command ||
      (full.insertTextFormat === 2 && (snippet === null || full.additionalTextEdits?.length))
    ) {
      coordinator.propose(accepted);

      return;
    }

    if (snippet && Predicate.isFunction(snippet.apply)) {
      snippet.apply(view, completion, proposal.from, proposal.to);

      return;
    }

    try {
      view.dispatch({
        changes: plainChanges(accepted),
        annotations: pickedCompletion.of(completion),
        userEvent: "input.complete",
      });
    } catch {
      coordinator.propose(accepted);
    }
  };

  const option: Completion = {
    ...base,
    apply: (view, completion) => {
      if (view.state.doc !== buffer.doc || !features.requests.current(provider, buffer)) return;
      const settled = resolver.settled();

      if (settled !== undefined) {
        accept(view, completion, settled);

        return;
      }

      // Auto-import edits arrive on resolve: wait briefly, closed so a second ↵ can't apply twice.
      closeCompletion(view);
      void resolver.within(SETTLE_MS).then((full) => accept(view, completion, full));
    },
  };

  const offset = item.filterText?.indexOf(item.label) ?? -1;

  if (base.displayLabel !== undefined && offset !== -1) labelOffsets.set(option, offset);

  return option;
};

export const completionSource =
  (
    features: LanguageFeatures,
    coordinator: CompletionCoordinator,
    label: (provider: LanguageProvider) => string = (provider) => provider.context.providerId
  ): CompletionSource =>
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
      .flatMap(({ provider, request, value, payload }) => {
        const items = completionItems(payload);

        return items.flatMap((item) => {
          try {
            const range = completionRange(buffer.doc, item, provider, from, context.pos);

            return [
              offeredBy(
                cmCompletion(
                  features,
                  { provider, request, result: value, buffer, item, ...range },
                  coordinator
                ),
                label(provider)
              ),
            ];
          } catch {
            return [];
          }
        });
      })
      .slice(0, 2000);

    return options.length ? { from, to: context.pos, options, getMatch } : null;
  };

/** Markdown hovers render sanitized (`docs.tsx`); the first hover waits for that chunk. */
export const hoverExtension = (
  features: LanguageFeatures,
  label: (provider: LanguageProvider) => string = (provider) => provider.context.providerId
) =>
  hoverTooltip(
    async (view, position) => {
      if (view.state.doc !== features.options.buffer().doc) return null;
      const [answers] = await Promise.all([features.hover(position), loadDocRenderer()]);

      if (!answers.length || view.state.doc !== features.options.buffer().doc) return null;

      const sections = answers.map(({ payload }) => hoverParts(payload.contents));
      const footnote = [...new Set(answers.map(({ provider }) => label(provider)))].join(", ");

      return {
        pos: position,
        create: () => {
          const dom = document.createElement("div");
          dom.setAttribute("role", "tooltip");

          return { dom, ...mountDocs(dom, { sections, footnote, variant: "hover" }) };
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

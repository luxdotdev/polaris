import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, keymap, showTooltip, ViewPlugin, type Tooltip } from "@codemirror/view";
import { signatureDocs } from "./docParts.ts";
import { loadDocRenderer, mountDocs } from "./docs.tsx";
import type { LanguageFeatures } from "./features.ts";
import type { LanguageProvider } from "./types.ts";

const ACK_POLL_MS = 50;

const ACK_ATTEMPTS = 40;

const signature = StateEffect.define<Tooltip | null>();

const field = StateField.define<Tooltip | null>({
  create: () => null,
  update: (current, transaction) => {
    let next = transaction.docChanged || transaction.selection ? null : current;

    for (const effect of transaction.effects) if (effect.is(signature)) next = effect.value;

    return next;
  },
  provide: (value) => showTooltip.from(value),
});

/** Signature help on the shared docs renderer, anchored at the unsaved caret and dismissed on change. */
export const signatureExtension = (
  features: LanguageFeatures,
  label: (provider: LanguageProvider) => string = (provider) => provider.context.providerId
): Extension => {
  const alive = new WeakSet<EditorView>();

  const request = async (view: EditorView) => {
    const buffer = features.options.buffer();
    const head = view.state.selection.main.head;
    const [answers] = await Promise.all([features.signature(head), loadDocRenderer()]);

    if (
      !alive.has(view) ||
      features.options.buffer().doc !== buffer.doc ||
      features.options.buffer().version !== buffer.version ||
      view.state.selection.main.head !== head
    )
      return;

    const shown = answers.flatMap(({ provider, payload }) => {
      const parts = signatureDocs(payload);

      return parts.length ? [{ parts, label: label(provider) }] : [];
    });

    const footnote = [...new Set(shown.map((answer) => answer.label))].join(", ");

    view.dispatch({
      effects: signature.of(
        shown.length
          ? {
              pos: head,
              above: false,
              create: () => {
                const dom = document.createElement("div");
                dom.setAttribute("role", "status");
                dom.setAttribute("data-signature-help", "");

                const sections = shown.map((answer) => answer.parts);

                return { dom, ...mountDocs(dom, { sections, footnote, variant: "hover" }) };
              },
            }
          : null
      ),
    });
  };

  /** A typed `(` or `,` waits for a server to acknowledge the edit; until then no server is asked. */
  const typed = async (view: EditorView) => {
    const doc = view.state.doc;

    for (let attempt = 0; attempt < ACK_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, ACK_POLL_MS));

      if (!alive.has(view) || view.state.doc !== doc) return;
      const buffer = features.options.buffer();

      if (
        features.options.providers().some((provider) => features.requests.current(provider, buffer))
      )
        return request(view);
    }
  };

  return [
    field,
    keymap.of([
      {
        key: "Ctrl-Shift-Space",
        run: (view) => {
          void request(view);

          return true;
        },
      },
      {
        key: "Escape",
        run: (view) => {
          if (view.state.field(field) === null) return false;
          view.dispatch({ effects: signature.of(null) });

          return true;
        },
      },
    ]),
    ViewPlugin.define((view) => {
      alive.add(view);

      return {
        destroy: () => {
          alive.delete(view);
        },
        update: (update) => {
          if (
            !update.docChanged ||
            !update.transactions.some((transaction) => transaction.isUserEvent("input.type"))
          )
            return;

          const char = update.state.sliceDoc(
            Math.max(0, update.state.selection.main.head - 1),
            update.state.selection.main.head
          );

          if (char === "(" || char === ",") void typed(update.view);
        },
      };
    }),
  ];
};

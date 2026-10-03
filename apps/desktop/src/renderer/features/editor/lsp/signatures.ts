import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, keymap, showTooltip, ViewPlugin, type Tooltip } from "@codemirror/view";
import type { LanguageFeatures } from "./features.ts";

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

/** Safe text-only signature help, anchored at the actual unsaved caret and dismissed on change. */
export const signatureExtension = (features: LanguageFeatures): Extension => {
  const alive = new WeakSet<EditorView>();

  const request = async (view: EditorView) => {
    const buffer = features.options.buffer();
    const head = view.state.selection.main.head;
    const answers = await features.signature(head);

    if (
      !alive.has(view) ||
      features.options.buffer().doc !== buffer.doc ||
      features.options.buffer().version !== buffer.version ||
      view.state.selection.main.head !== head
    )
      return;

    const text = answers
      .flatMap(({ provider, payload }) => {
        const selected = payload.signatures[payload.activeSignature ?? 0];

        return selected ? [`${provider.context.providerId} · ${selected.label}`] : [];
      })
      .join("\n");

    view.dispatch({
      effects: signature.of(
        text
          ? {
              pos: head,
              above: false,
              create: () => {
                const dom = document.createElement("div");
                dom.className =
                  "text-caption text-text-default bg-surface-raised border-hairline max-w-lg whitespace-pre-wrap rounded-control border px-row-x py-gap shadow-float";
                dom.setAttribute("role", "status");
                dom.textContent = text;

                return { dom };
              },
            }
          : null
      ),
    });
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

          if (char === "(" || char === ",") void request(update.view);
        },
      };
    }),
  ];
};

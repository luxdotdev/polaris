import { Prec, type Extension } from "@codemirror/state";
import { keymap, ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { currentKeyPlatform } from "../../../../shared/chord.ts";
import { currentMode } from "../cm/vim.ts";
import {
  acceptedPrediction,
  acceptPrediction,
  ghost,
  ghostDecorations,
  ghostTheme,
  popupOrSnippet,
  setGhost,
} from "./state.ts";
import type { PredictionPort } from "./types.ts";

import { markPrediction } from "./timing.ts";

class Requests {
  private active: AbortController | null = null;
  private disposed = false;
  private readonly unsubscribe: () => void;
  constructor(
    private readonly view: EditorView,
    private readonly port: PredictionPort
  ) {
    this.unsubscribe = port.subscribe(() => {
      this.cancel();
      this.view.dispatch({ effects: setGhost.of(null) });
    });
  }
  private cancel() {
    const preview = this.view.state.field(ghost, false);
    this.active?.abort();
    this.active = null;

    if (preview?.provisional)
      queueMicrotask(() => {
        if (
          !this.disposed &&
          this.active === null &&
          this.view.state.field(ghost, false) === preview
        )
          this.view.dispatch({ effects: setGhost.of(null) });
      });
  }
  dismiss() {
    const pending = this.active !== null;
    this.cancel();

    return pending;
  }
  update(update: ViewUpdate) {
    if (!update.docChanged && !update.selectionSet) {
      if (update.focusChanged && !this.view.hasFocus) this.cancel();

      return;
    }

    this.cancel();

    if (
      !update.docChanged ||
      update.transactions.some((tr) => tr.annotation(acceptedPrediction)) ||
      !this.view.hasFocus ||
      !this.port.allowed(this.view)
    )
      return;
    const mode = currentMode(this.view);

    if (mode !== null && mode !== "insert") return;
    const { state } = this.view;

    if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return;
    const controller = new AbortController();
    this.active = controller;
    markPrediction("keystroke");
    const input = { buffer: state.doc.toString(), cursor: state.selection.main.head };

    const current = () =>
      !controller.signal.aborted &&
      this.active === controller &&
      this.port.allowed(this.view) &&
      this.view.state.doc === state.doc &&
      this.view.state.selection.main.head === input.cursor;

    let rendered = false;

    const renderedOnce = () => {
      if (rendered) return;
      rendered = true;
      markPrediction("render");
    };

    const show = (text: string, provisional: boolean) => {
      if (!current() || (this.view.state.field(ghost)?.text ?? "") === text) return;
      this.view.dispatch({
        effects: setGhost.of(text ? { text, provisional, at: input.cursor } : null),
      });

      if (text) renderedOnce();
    };

    void this.port
      .request(input, controller.signal, (text) => {
        queueMicrotask(() => show(text, true));
      })
      .then(
        (prediction) => {
          if (!current()) return;
          const shown = this.view.state.field(ghost)?.text;
          const text = shown && prediction.text.startsWith(shown) ? shown : prediction.text;
          this.view.dispatch({
            effects: setGhost.of(
              text ? { ...prediction, text, provisional: false, at: input.cursor } : null
            ),
          });
          this.active = null;

          if (text) renderedOnce();
        },
        () => {
          if (!current()) return;
          show("", false);
          this.active = null;
        }
      );
  }
  destroy() {
    this.disposed = true;
    this.cancel();
    this.unsubscribe();
  }
}

/** Each view owns a single cancellable request; no debounce or idle timer. */
export const predictionExtension = (port: PredictionPort): Extension => {
  const requests = ViewPlugin.define((view) => new Requests(view, port));

  return [
    ghost,
    ghostDecorations,
    ghostTheme,
    requests,
    Prec.highest(
      keymap.of([
        { key: "Tab", run: (view) => port.allowed(view) && acceptPrediction(view) },
        {
          key: currentKeyPlatform() === "mac" ? "Alt-ArrowRight" : "Ctrl-ArrowRight",
          run: (view) => port.allowed(view) && acceptPrediction(view, true),
        },
        {
          key: "Escape",
          run: (view) => {
            const delegate = popupOrSnippet(view.state);
            const pending = view.plugin(requests)?.dismiss() ?? false;

            if (view.state.field(ghost) === null && !pending) return false;
            view.dispatch({ effects: setGhost.of(null) });

            return !delegate;
          },
        },
      ])
    ),
  ];
};

export { acceptPrediction, ghost, setGhost, visibleGhost } from "./state.ts";

export type { AdditionalEdit, Prediction, PredictionInput, PredictionPort } from "./types.ts";

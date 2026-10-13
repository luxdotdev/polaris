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
  setGhost,
} from "./state.ts";
import type { PredictionPort } from "./types.ts";

class Requests {
  private active: AbortController | null = null;
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
    this.active?.abort();
    this.active = null;
  }
  dismiss() {
    const pending = this.active !== null;
    this.cancel();

    return pending;
  }
  update(update: ViewUpdate) {
    if (!update.docChanged && !update.selectionSet && !update.focusChanged) return;
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
    const input = { buffer: state.doc.toString(), cursor: state.selection.main.head };
    void this.port.request(input, controller.signal).then(
      (prediction) => {
        if (
          controller.signal.aborted ||
          this.active !== controller ||
          !this.port.allowed(this.view) ||
          this.view.state.doc !== state.doc ||
          this.view.state.selection.main.head !== input.cursor
        )
          return;
        this.active = null;
        this.view.dispatch({
          effects: setGhost.of(
            prediction.text.length === 0 ? null : { ...prediction, at: input.cursor }
          ),
        });
      },
      () => {
        if (this.active === controller) this.active = null;
      }
    );
  }
  destroy() {
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
            const pending = view.plugin(requests)?.dismiss() ?? false;

            if (view.state.field(ghost) === null && !pending) return false;
            view.dispatch({ effects: setGhost.of(null) });

            return true;
          },
        },
      ])
    ),
  ];
};

export { acceptPrediction, ghost, setGhost, visibleGhost } from "./state.ts";

export type { AdditionalEdit, Prediction, PredictionInput, PredictionPort } from "./types.ts";

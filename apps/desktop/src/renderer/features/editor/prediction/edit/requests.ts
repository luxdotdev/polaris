/**
 * One `prediction.edit` request per Editor (docs/specs/edit-prediction-v1.1.md §4–§5): started
 * after a pause and on acceptance, cancelled by any keystroke, then the jump probe when the model
 * has nothing at the cursor. Also finalizes each prediction into an outcome record (§8).
 */
import { Compartment, Facet, type Text } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { EditHistoryHunk } from "@polaris/protocol";
import { outcomeLanguageId, outcomeModelId } from "../../../../../shared/predictionOutcomes.ts";
import { editorFile } from "../../cm/extensions.ts";
import { currentMode } from "../../cm/vim.ts";
import { languageFor } from "../../model/language.ts";
import { openPopupOrSnippet } from "../state.ts";
import { markPrediction } from "../timing.ts";
import { revertsBurst } from "./guards.ts";
import { editAccepted, historyOf, historyThroughBurst, lastEditText } from "./history.ts";
import { burstLines, changedLines, ImportLookups } from "./importLookups.ts";
import {
  type EditFinal,
  type EditPrediction,
  hunksValid,
  isJump,
  isLargeDeletion,
  kindOf,
  linesAdded,
  linesRemoved,
  predictionId,
  sortHunks,
} from "./model.ts";
import {
  countKeystroke,
  emitPredictionOutcome,
  flushKeystrokes,
  type PredictionOutcome,
  UNDO_WINDOW_MS,
} from "./outcomes.ts";
import { jumpFocus } from "./probe.ts";
import { DEFAULT_EDIT_PREDICTION_SETTINGS, type EditPredictionSettings } from "./settings.ts";
import {
  editDisplay,
  editPrediction,
  liftSuppression,
  pointerSelecting,
  setEditPrediction,
  suppression,
  suppressLine,
} from "./state.ts";

export interface EditPredictionInput {
  readonly buffer: string;
  readonly cursor: number;
  readonly focus: number | null;
  readonly history: ReadonlyArray<EditHistoryHunk>;
}

export interface EditPredictionPort {
  /** A next-edit model serves this Workspace; otherwise v1's FIM path runs as before. */
  readonly available: () => boolean;
  readonly request: (input: EditPredictionInput, signal: AbortSignal) => Promise<EditFinal>;
  readonly settings: () => EditPredictionSettings;
  /** Fires when availability or settings changed; pending work is dropped and the display synced. */
  readonly subscribe: (refresh: () => void) => () => void;
}

export const displayCompartment = new Compartment();

/** The port the extension was installed with; one per editor state. */
export const editPort = Facet.define<EditPredictionPort, EditPredictionPort | null>({
  combine: (values) => values[0] ?? null,
});

const NO_PORT: EditPredictionPort = {
  available: () => false,
  request: () => Promise.reject(new Error("Edit predictions are not installed")),
  settings: () => DEFAULT_EDIT_PREDICTION_SETTINGS,
  subscribe: () => () => undefined,
};

type Kind = "regular" | "chain" | "probe";

interface Flight {
  readonly controller: AbortController;
  readonly kind: Kind;
}

type Resolution = NonNullable<PredictionOutcome["outcome"]>;

type Guard = NonNullable<PredictionOutcome["guard"]>;

/** An acceptance under observation for undo, until the window closes or the Editor goes. */
interface Observed {
  readonly record: PredictionOutcome;
  readonly before: Text;
  readonly at: number;
  readonly timer: ReturnType<typeof setTimeout>;
}

const recordOf = (
  prediction: EditPrediction,
  language: string,
  outcome: Resolution | null,
  guard: Guard | null
): PredictionOutcome => ({
  time: Date.now(),
  language: outcomeLanguageId(language),
  model: outcomeModelId(prediction.model),
  format: prediction.format,
  side: prediction.side,
  kind: kindOf(prediction),
  hunkCount: prediction.hunks.length,
  linesAdded: linesAdded(prediction.hunks),
  linesRemoved: linesRemoved(prediction.doc, prediction.hunks),
  requestToFinalMs: prediction.requestToFinal,
  finalToShownMs: outcome === null ? null : prediction.finalToShown,
  outcome,
  undoneWithin30s: false,
  guard,
});

const isKeystroke = (update: ViewUpdate) =>
  update.transactions.some(
    (tr) => tr.docChanged && tr.isUserEvent("input") && !tr.isUserEvent("input.complete")
  );

class EditRequests {
  private flight: Flight | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The last keystroke's prediction is still owed, e.g. a popup or snippet was open at the pause. */
  private due = false;
  private disposed = false;
  private observed: Observed | null = null;
  private readonly port: EditPredictionPort;
  private readonly unsubscribe: () => void;
  private readonly imports: ImportLookups;
  constructor(private readonly view: EditorView) {
    this.port = view.state.facet(editPort) ?? NO_PORT;
    this.imports = new ImportLookups(view, {
      modelBusy: () => this.flight !== null || this.timer !== null || this.modelShown(),
      show: (prediction) => this.showImport(prediction),
    });
    this.unsubscribe = this.port.subscribe(() => {
      this.cancel();
      this.clear("superseded");
      this.syncDisplay();
    });
  }
  private get language() {
    return languageFor(this.view.state.facet(editorFile)?.path ?? "");
  }
  private finalize(prediction: EditPrediction, outcome: Resolution | null, guard: Guard | null) {
    const record = recordOf(prediction, this.language, outcome, guard);
    emitPredictionOutcome(record);

    return record;
  }
  private syncDisplay() {
    const { display } = this.port.settings();

    if (!this.disposed && this.view.state.facet(editDisplay) !== display)
      this.view.dispatch({ effects: displayCompartment.reconfigure(editDisplay.of(display)) });
  }
  private clear(outcome: Resolution) {
    const shown = this.view.state.field(editPrediction);

    if (shown === null) return;
    this.finalize(shown, outcome, null);
    this.view.dispatch({ effects: setEditPrediction.of(null) });
  }
  private cancel() {
    this.flight?.controller.abort();
    this.flight = null;
    this.imports.cancel();

    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  private allowed() {
    const { state } = this.view;
    const mode = currentMode(this.view);

    return (
      this.port.available() &&
      this.view.hasFocus &&
      (mode === null || mode === "insert") &&
      state.selection.ranges.length === 1 &&
      state.selection.main.empty &&
      !state.field(pointerSelecting) &&
      !openPopupOrSnippet(state) &&
      state.field(suppression) === null
    );
  }
  private schedule() {
    this.timer = setTimeout(() => {
      this.timer = null;

      if (this.disposed || !this.allowed()) return;
      void this.request("regular", null);
      this.imports.start(burstLines(this.view.state));
    }, this.port.settings().restraints.pauseMs);
  }
  update(update: ViewUpdate) {
    if (this.view.state.facet(editDisplay) !== this.port.settings().display)
      queueMicrotask(() => this.syncDisplay());
    const accepted = update.transactions.map((tr) => tr.annotation(editAccepted)).find(Boolean);

    if (accepted !== undefined) this.onAccepted(accepted, update);
    else if (update.docChanged || update.selectionSet) this.onEdit(update);
    else this.onQuiet(update);
  }
  private onEdit(update: ViewUpdate) {
    const had = update.startState.field(editPrediction);
    this.cancel();
    this.due = false;

    if (had !== null && update.state.field(editPrediction) === null)
      this.finalize(had, update.docChanged ? "replaced-by-typing" : "ignored", null);

    if (!update.docChanged) return;

    if (isKeystroke(update)) countKeystroke();
    this.noteUndo(update);
    this.due = true;

    if (this.allowed()) this.schedule();
  }
  private onQuiet(update: ViewUpdate) {
    const had = update.startState.field(editPrediction);

    if (
      had !== null &&
      update.transactions.some((tr) => tr.effects.some((e) => e.is(suppressLine)))
    )
      this.finalize(had, "dismissed-esc", null);

    if (update.focusChanged && !this.view.hasFocus) this.cancel();

    if (this.due && this.timer === null && this.flight === null && this.allowed()) this.schedule();
  }
  private onAccepted(prediction: EditPrediction, update: ViewUpdate) {
    const before = update.startState.doc;
    this.cancel();
    this.settleObserved(false);
    const record = recordOf(prediction, this.language, "accepted", null);

    this.observed = {
      record,
      before,
      at: performance.now(),
      timer: setTimeout(() => this.settleObserved(false), UNDO_WINDOW_MS),
    };

    if (!this.allowed()) return;
    void this.request("chain", null);
    this.imports.start(changedLines(update.state.doc, update.changes));
  }
  /** Emits the accepted record once: on undo inside the window, when it closes, or on disposal. */
  private settleObserved(undone: boolean) {
    const observed = this.observed;

    if (observed === null) return;
    clearTimeout(observed.timer);
    this.observed = null;
    emitPredictionOutcome({ ...observed.record, undoneWithin30s: undone });
  }
  private noteUndo(update: ViewUpdate) {
    const observed = this.observed;

    if (observed === null || !update.transactions.some((tr) => tr.isUserEvent("undo"))) return;

    if (performance.now() - observed.at < UNDO_WINDOW_MS && update.state.doc.eq(observed.before))
      this.settleObserved(true);
  }
  private request(kind: Kind, focus: number | null): Promise<void> {
    const { state } = this.view;
    const { doc } = state;
    const cursor = state.selection.main.head;
    const controller = new AbortController();
    const flight: Flight = { controller, kind };
    this.flight = flight;
    this.due = false;
    const startedAt = performance.now();
    markPrediction("edit.request");
    const input = { buffer: doc.toString(), cursor, focus, history: historyOf(state).frozen };

    const current = () =>
      this.flight === flight &&
      !controller.signal.aborted &&
      this.view.state.doc === doc &&
      this.view.state.selection.main.head === cursor &&
      this.port.available();

    return this.port.request(input, controller.signal).then(
      (final) => {
        if (!current()) return;
        this.flight = null;

        if (!this.show(final, cursor, startedAt) && kind !== "probe") this.probe(final.window);
        this.modelDone();
      },
      () => {
        if (this.flight !== flight) return;
        this.flight = null;
        this.modelDone();
      }
    );
  }
  private modelShown() {
    const shown = this.view.state.field(editPrediction);

    return shown !== null && shown.import === undefined;
  }
  /** No model request left and nothing shown: an import that waited may show. */
  private modelDone() {
    if (this.flight === null && this.view.state.field(editPrediction) === null)
      this.imports.release();
  }
  private showImport(prediction: EditPrediction) {
    if (this.disposed || !this.allowed()) return;
    this.view.dispatch({
      effects: setEditPrediction.of({ ...prediction, shownAt: performance.now() }),
    });
  }
  private guard(prediction: EditPrediction): Guard | null {
    const { restraints } = this.port.settings();

    if (!restraints.jumpsOffered && isJump(prediction.doc, prediction.hunks, prediction.anchor))
      return "aggressiveness";

    if (!restraints.largeDeletionsOffered && isLargeDeletion(prediction.doc, prediction.hunks))
      return "aggressiveness";

    return revertsBurst(prediction.hunks, historyOf(this.view.state).burst) === null
      ? null
      : "recent-edit";
  }
  private show(final: EditFinal, cursor: number, startedAt: number): boolean {
    const { doc } = this.view.state;
    const hunks = sortHunks(final.edits);

    if (hunks.length === 0 || !hunksValid(doc, hunks)) return false;
    const finalAt = performance.now();

    const prediction: EditPrediction = {
      id: predictionId(),
      hunks,
      cursor: final.cursor,
      window: final.window,
      doc,
      anchor: cursor,
      phase: "shown",
      shownAt: finalAt,
      finalToShown: 0,
      model: final.model,
      format: final.format,
      side: final.side,
      requestToFinal: finalAt - startedAt,
    };

    const guard = this.guard(prediction);

    if (guard !== null) {
      this.finalize(prediction, null, guard);

      return false;
    }

    const shown = this.view.state.field(editPrediction);

    if (shown?.import !== undefined) this.finalize(shown, "superseded", null);
    const shownAt = performance.now();
    this.view.dispatch({
      effects: setEditPrediction.of({ ...prediction, shownAt, finalToShown: shownAt - finalAt }),
    });
    markPrediction("edit.render");

    return true;
  }
  private probe(window: EditFinal["window"]) {
    const { state } = this.view;

    const target = jumpFocus(this.port.settings().restraints.jumpProbe, {
      buffer: state.doc.toString(),
      path: state.facet(editorFile)?.path ?? "",
      cursor: state.selection.main.head,
      window,
      history: historyThroughBurst(state),
      last: lastEditText(historyOf(state)),
    });

    if (target !== null && this.allowed()) void this.request("probe", target);
  }
  /** Esc: drops pending work; true when a request or timer was pending. */
  dismiss(): boolean {
    const pending = this.flight !== null || this.timer !== null;
    this.cancel();

    return pending;
  }
  /** "Show last edit prediction": the dismissed one if the buffer is unchanged, else a request. */
  showLast(): boolean {
    const held = this.view.state.field(suppression);

    if (held === null) return false;

    if (held.last !== null && held.last.doc === this.view.state.doc) {
      const shownAt = performance.now();
      this.view.dispatch({
        effects: [
          liftSuppression.of(null),
          setEditPrediction.of({ ...held.last, phase: "shown", shownAt }),
        ],
      });

      return true;
    }

    this.view.dispatch({ effects: liftSuppression.of(null) });

    if (this.allowed()) void this.request("regular", null);

    return true;
  }
  destroy() {
    this.disposed = true;
    this.cancel();
    this.settleObserved(false);
    flushKeystrokes();
    this.unsubscribe();
  }
}

export const editRequests = ViewPlugin.define((view) => new EditRequests(view));

export const showLastEditPrediction = (view: EditorView): boolean =>
  view.plugin(editRequests)?.showLast() ?? false;

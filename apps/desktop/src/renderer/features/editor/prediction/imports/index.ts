/**
 * Import Edit Predictions (docs/specs/edit-prediction-v1.1.md §5 "Imports"): the language server's
 * own quick fix for an unresolved name, offered with Tab. The Editor's language coordinator
 * provides `importSource` per view; the Edit Prediction path asks it after a burst or acceptance.
 */
import { Facet, type Text } from "@codemirror/state";
import type { PredictedEdit } from "@polaris/protocol";

/** A quick fix ready to offer: the server's title and its insertions as offsets in `doc`. */
export interface ImportCandidate {
  readonly title: string;
  /** Sorted, pure insertions. */
  readonly hunks: ReadonlyArray<PredictedEdit>;
  /** The buffer the server answered for. */
  readonly doc: Text;
  /** The language server's edit fence still holds: same provider acknowledgment and version. */
  readonly current: () => boolean;
}

/** The lines a burst or acceptance changed, and the names its inserted text wrote. */
export interface ImportBurst {
  readonly from: number;
  readonly to: number;
  readonly names: ReadonlySet<string>;
}

export interface ImportSource {
  /** Waits for the buffer's diagnostics, then the fix for the burst's unresolved names, if any. */
  readonly find: (burst: ImportBurst, signal: AbortSignal) => Promise<ImportCandidate | null>;
}

export const importSource = Facet.define<ImportSource, ImportSource | null>({
  combine: (values) => values[0] ?? null,
});

export {
  type ImportAction,
  type ImportActionSelector,
  type ImportChoice,
  type ImportDocument,
  type ImportInsert,
  type ImportName,
  insertOnlyEdit,
  moduleImportRule,
  selectImportAction,
  specImportRule,
} from "./selector.ts";

export { type DiagnosticCue, isUnresolvedName } from "./unresolved.ts";

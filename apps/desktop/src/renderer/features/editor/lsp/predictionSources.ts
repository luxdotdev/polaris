/** What an Editor's language coordinator lends the Edit Prediction path: imports and the verifier. */
import type { Extension } from "@codemirror/state";
import type { LanguageApi } from "../../../../shared/api.ts";
import { importSource } from "../prediction/imports/index.ts";
import { diagnosticsVerifier } from "../prediction/verify/index.ts";
import type { LanguageDiagnosticFeed } from "./diagnostics.ts";
import type { LanguageFeatures } from "./features.ts";
import { languageImportSource } from "./imports.ts";
import { languageDiagnosticsVerifier, type VerifierEntry } from "./verify.ts";

/** Read live: the coordinator replaces `groups` and `language` as providers change. */
export interface PredictionEntry extends VerifierEntry {
  readonly diagnostics: LanguageDiagnosticFeed;
  readonly features: LanguageFeatures;
}

export const predictionSources = (entry: PredictionEntry, api: LanguageApi): Extension => [
  importSource.of(languageImportSource(entry)),
  diagnosticsVerifier.of(languageDiagnosticsVerifier(entry, api)),
];

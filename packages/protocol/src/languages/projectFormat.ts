import { Schema } from "effect";
import { deferredSchema } from "./deferred.ts";
import {
  LanguageCheckout,
  LanguageCounter,
  LanguageDeadline,
  LanguageKey,
  LanguagePath,
  LanguageText,
} from "./base.ts";
import { LanguageDocumentText } from "./documents.ts";

/** A formatter the checkout itself configures, run from its own `node_modules/.bin`. */
export const LanguageProjectFormatterTool = Schema.Literals([
  "oxfmt",
  "prettier",
  "biome",
  "dprint",
]);

export type LanguageProjectFormatterTool = typeof LanguageProjectFormatterTool.Type;

/**
 * Detected without running anything: the nearest config for the file (or the nearest package
 * that depends on the tool), and whether the tool's ignore files exclude the file.
 */
export const LanguageProjectFormatter = Schema.Struct({
  tool: LanguageProjectFormatterTool,
  /** The directory the formatter runs in: the config's, or the depending package's. */
  root: LanguagePath,
  config: Schema.NullOr(LanguagePath),
  /** The checkout has the tool's binary under some `node_modules/.bin` up to its root. */
  installed: Schema.Boolean,
  ignored: Schema.Boolean,
});

export type LanguageProjectFormatter = typeof LanguageProjectFormatter.Type;

/** `version` is the buffer's; the outcome echoes it so the Client applies only a current result. */
export const LanguageProjectFormatInput = Schema.Struct({
  checkout: LanguageCheckout,
  path: LanguagePath,
  requestId: LanguageKey,
  version: LanguageCounter,
  text: LanguageDocumentText,
  deadline: LanguageDeadline,
});

export type LanguageProjectFormatInput = typeof LanguageProjectFormatInput.Type;

export const LanguageProjectFormatOutcome = deferredSchema(() =>
  Schema.TaggedUnion({
    Formatted: {
      requestId: LanguageKey,
      version: LanguageCounter,
      tool: LanguageProjectFormatterTool,
      text: LanguageDocumentText,
    },
    Skipped: {
      requestId: LanguageKey,
      version: LanguageCounter,
      reason: Schema.Literals(["ignored", "no-formatter"]),
    },
    Failed: {
      requestId: LanguageKey,
      reason: Schema.Literals(["not-installed", "timeout", "cancelled", "formatter-failed"]),
      message: LanguageText,
    },
  })
);

export type LanguageProjectFormatOutcome = typeof LanguageProjectFormatOutcome.Type;

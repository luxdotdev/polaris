import { EditPredictionFormat, PredictionFormat, SuppressedReason } from "@polaris/protocol";
import { Option, Schema } from "effect";

const Count = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
);

const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

/** Canonical IDs only: endpoint aliases can contain local paths or user identifiers. */
export const OutcomeModel = Schema.Literals([
  "zeta-2.1",
  "sweep-next-edit",
  "mellum-2",
  "qwen-2.5-coder-1.5b",
  "unknown",
]);

export const OutcomeLanguage = Schema.Literals([
  "typescript",
  "typescriptreact",
  "tsx",
  "javascript",
  "javascriptreact",
  "jsx",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "css",
  "scss",
  "html",
  "json",
  "jsonc",
  "markdown",
  "mdx",
  "php",
  "ruby",
  "shell",
  "shellscript",
  "bash",
  "sql",
  "yaml",
  "toml",
  "xml",
  "swift",
  "kotlin",
  "lua",
  "vue",
  "svelte",
  "dockerfile",
  "makefile",
  "diff",
  "plaintext",
  "unknown",
]);

export const outcomeLanguageId = (language: string): typeof OutcomeLanguage.Type =>
  Option.getOrElse(Schema.decodeUnknownOption(OutcomeLanguage)(language), () => "unknown");

export const outcomeModelId = (model: string): typeof OutcomeModel.Type => {
  if (/zeta[\W_]*2[._-]?1/i.test(model)) return "zeta-2.1";

  if (/sweep.*next[\W_]*edit/i.test(model)) return "sweep-next-edit";

  if (/mellum[\W_]*2/i.test(model)) return "mellum-2";

  if (/qwen[\W_]*2[._-]?5[\W_]*coder[\W_]*1[._-]?5b/i.test(model)) return "qwen-2.5-coder-1.5b";

  return "unknown";
};

export const PredictionKind = Schema.Literals(["insert", "replace", "delete", "import", "jump"]);

export type PredictionKind = typeof PredictionKind.Type;

const OutcomeFields = Schema.Struct({
  time: Count,
  language: OutcomeLanguage,
  model: OutcomeModel,
  format: Schema.NullOr(Schema.Union([PredictionFormat, EditPredictionFormat])),
  side: Schema.Literals(["client", "host"]),
  kind: PredictionKind,
  hunkCount: Count,
  linesAdded: Count,
  linesRemoved: Count,
  requestToFinalMs: Milliseconds,
  finalToShownMs: Schema.NullOr(Milliseconds),
  outcome: Schema.NullOr(
    Schema.Literals(["accepted", "dismissed-esc", "replaced-by-typing", "superseded", "ignored"])
  ),
  undoneWithin30s: Schema.Boolean,
  guard: Schema.NullOr(
    Schema.Union([
      SuppressedReason,
      Schema.Literals([
        "recent-edit",
        "selection",
        "completion-popup",
        "snippet",
        "aggressiveness",
      ]),
    ])
  ),
}).check(
  Schema.makeFilter(
    (record) =>
      (record.outcome !== null || record.guard !== null) &&
      (record.outcome === null ? record.finalToShownMs === null : record.finalToShownMs !== null) &&
      (!record.undoneWithin30s || record.outcome === "accepted")
  )
);

export const PredictionOutcome = Schema.Record(Schema.String, Schema.Unknown)
  .check(
    Schema.makeFilter((record) =>
      Object.keys(record).every((key) => Object.hasOwn(OutcomeFields.fields, key))
    )
  )
  .pipe(Schema.decodeTo(OutcomeFields));

export type PredictionOutcome = typeof PredictionOutcome.Type;

/** Delta since the preceding counter message, including typing that produced no prediction. */
export const PredictionKeystrokes = Schema.Record(Schema.String, Schema.Unknown)
  .check(Schema.makeFilter((record) => Object.keys(record).every((key) => key === "keystrokes")))
  .pipe(Schema.decodeTo(Schema.Struct({ keystrokes: Count })));

export type PredictionKeystrokes = typeof PredictionKeystrokes.Type;

export const PredictionLogRecord = Schema.Union([PredictionOutcome, PredictionKeystrokes]);

export type PredictionLogRecord = typeof PredictionLogRecord.Type;

export interface PredictionMetrics {
  readonly shown: number;
  readonly accepted: number;
  readonly acceptanceWindow: number;
  readonly acceptanceRate: number | null;
  readonly keystrokes: number;
  readonly shownPer100Keystrokes: number | null;
  readonly undoneWithin30s: number;
  readonly undoneRate: number | null;
  readonly countsByKind: Readonly<Record<PredictionKind, number>>;
}

export const PredictionOutcomeInputs = {
  "prediction.metrics": Schema.Struct({}),
  "prediction.outcomes.clear": Schema.Struct({}),
} as const;

export interface PredictionOutcomeOutputs {
  readonly "prediction.metrics": PredictionMetrics;
  readonly "prediction.outcomes.clear": null;
}

export const PredictionNotifications = {
  "prediction.outcome": PredictionOutcome,
  "prediction.keystrokes": PredictionKeystrokes,
} as const;

export type PredictionNotification = keyof typeof PredictionNotifications;

export type PredictionNotificationInput<M extends PredictionNotification> =
  (typeof PredictionNotifications)[M]["Type"];

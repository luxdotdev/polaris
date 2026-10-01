/**
 * Polaris's own ast-grep rule pack (`pack/*.yml`, docs/research/rules-layer.md
 * appendix): parsed and checked once, then grouped per language so a scan
 * walks each file once (`scan.ts`). napi takes only `rule`, `constraints` and
 * `utils`; Polaris applies `ignores`, `files`, the message and the Severity itself.
 */
import { createHash } from "node:crypto";
import type { NapiConfig } from "@ast-grep/napi";
import type { Severity } from "@polaris/protocol";
import { Schema } from "effect";
import bash from "./pack/bash.yml" with { type: "text" };
import go from "./pack/go.yml" with { type: "text" };
import python from "./pack/python.yml" with { type: "text" };
import rust from "./pack/rust.yml" with { type: "text" };
import tsx from "./pack/tsx.yml" with { type: "text" };

export const PACK_LANGUAGES = ["tsx", "python", "go", "rust", "bash"] as const;

export type PackLanguage = (typeof PACK_LANGUAGES)[number];

/** Bun types YAML imports as `any`; with `type: "text"` they are strings, checked here. */
const text = Schema.decodeUnknownSync(Schema.String);

const RuleBody = Schema.Record(Schema.String, Schema.Unknown);

const RuleDocument = Schema.Struct({
  id: Schema.String,
  language: Schema.Literals(PACK_LANGUAGES),
  severity: Schema.Literals(["error", "warning", "info", "hint"]),
  message: Schema.String,
  note: Schema.optional(Schema.String),
  metadata: Schema.Struct({
    "polaris-severity": Schema.Literals(["Critical", "High", "Medium", "Low"]),
    category: Schema.String,
    /** 0–1; a broad rule starts lower. Defaults to 0.7 (rules-layer.md §5). */
    confidence: Schema.optional(Schema.Number),
  }),
  rule: RuleBody,
  constraints: Schema.optional(Schema.Record(Schema.String, RuleBody)),
  utils: Schema.optional(Schema.Record(Schema.String, RuleBody)),
  ignores: Schema.optional(Schema.Array(Schema.String)),
  files: Schema.optional(Schema.Array(Schema.String)),
});

type RuleDocument = typeof RuleDocument.Type;

export interface PackRule {
  readonly id: string;
  readonly language: PackLanguage;
  readonly severity: Severity;
  readonly confidence: number;
  readonly category: string;
  readonly message: string;
  readonly note: string | null;
  /** SHA-256 of the rule's YAML document: a changed rule is a different rule. */
  readonly hash: string;
  readonly config: NapiConfig;
  readonly ignores: ReadonlyArray<Bun.Glob>;
  readonly files: ReadonlyArray<Bun.Glob> | null;
}

const decodeRule = Schema.decodeUnknownSync(RuleDocument);

const SEVERITY: Readonly<Record<RuleDocument["metadata"]["polaris-severity"], Severity>> = {
  Critical: "critical",
  High: "high",
  Medium: "medium",
  Low: "low",
};

const toRule = (doc: RuleDocument, source: string): PackRule => ({
  id: doc.id,
  language: doc.language,
  severity: SEVERITY[doc.metadata["polaris-severity"]],
  confidence: doc.metadata.confidence ?? 0.7,
  category: doc.metadata.category,
  message: doc.message,
  note: doc.note ?? null,
  hash: createHash("sha256").update(source).digest("hex"),
  // SAFETY: ast-grep validates rule bodies itself on first use; pack.test.ts runs every rule.
  config: { rule: doc.rule, constraints: doc.constraints, utils: doc.utils } as NapiConfig,
  ignores: (doc.ignores ?? []).map((glob) => new Bun.Glob(glob)),
  files: doc.files === undefined ? null : doc.files.map((glob) => new Bun.Glob(glob)),
});

/** Splits a multi-document YAML file on its `---` lines. */
export const splitDocuments = (text: string): ReadonlyArray<string> =>
  text
    .split(/^---$/m)
    .map((doc) => doc.trim())
    .filter((doc) => doc.length > 0);

export const parsePack = (sources: Readonly<Record<string, string>>): ReadonlyArray<PackRule> =>
  Object.values(sources).flatMap((text) =>
    splitDocuments(text).map((doc) => toRule(decodeRule(Bun.YAML.parse(doc)), doc))
  );

let pack: ReadonlyArray<PackRule> | null = null;

/** The built-in pack, parsed on first use. */
export const builtinPack = (): ReadonlyArray<PackRule> =>
  (pack ??= parsePack({
    tsx: text(tsx),
    python: text(python),
    go: text(go),
    rust: text(rust),
    bash: text(bash),
  }));

/** Whether `rule` applies to `path` (repo-relative), by its `files` and `ignores` globs. */
export const appliesTo = (rule: PackRule, path: string): boolean =>
  (rule.files === null || rule.files.some((glob) => glob.match(path))) &&
  !rule.ignores.some((glob) => glob.match(path));

const EXTENSIONS: ReadonlyArray<readonly [RegExp, PackLanguage]> = [
  // Every JS/TS flavour parses with the TSX grammar, so one rule covers them all.
  [/\.(?:[cm]?[jt]s|[jt]sx)$/i, "tsx"],
  [/\.pyi?$/i, "python"],
  [/\.go$/i, "go"],
  [/\.rs$/i, "rust"],
  [/\.(?:sh|bash)$/i, "bash"],
];

/** The pack language a file is scanned as, or null when no rule covers it. */
export const languageOf = (path: string): PackLanguage | null =>
  EXTENSIONS.find(([pattern]) => pattern.test(path))?.[1] ?? null;

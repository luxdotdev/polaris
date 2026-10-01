/**
 * Runs the pack over source files, one parse and one tree walk per file: the
 * file's rules are combined into a single `any` to find candidate nodes,
 * then each candidate is checked against each rule with its own
 * constraints. Constraints can't be combined: ast-grep checks them after the
 * first matching branch, so one rule's constraint would hide another's match.
 */
import type { NapiConfig, SgNode } from "@ast-grep/napi";
import type { AstGrep } from "./native.ts";
import { appliesTo, type PackLanguage, type PackRule } from "./pack.ts";

/** One rule's match: 1-based, inclusive lines on the scanned (new) file. */
export interface PatternMatch {
  readonly ruleId: string;
  readonly path: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const toMatch = (rule: PackRule, path: string, node: SgNode): PatternMatch => {
  const range = node.range();

  return {
    ruleId: rule.id,
    path,
    start: range.start.line + 1,
    end: range.end.line + 1,
    text: node.text(),
  };
};

/** Rules with `utils` can't share a combined config (their names could clash): they walk alone. */
const combinable = (rule: PackRule) => rule.config.utils === undefined;

export const scanSource = (
  napi: AstGrep,
  rules: ReadonlyArray<PackRule>,
  path: string,
  language: PackLanguage,
  source: string
): ReadonlyArray<PatternMatch> => {
  const applicable = rules.filter((rule) => rule.language === language && appliesTo(rule, path));

  if (applicable.length === 0) return [];
  const root = napi.parse(language === "tsx" ? napi.Lang.Tsx : language, source).root();
  const shared = applicable.filter(combinable);
  const matches: Array<PatternMatch> = [];

  if (shared.length > 0) {
    const combined: NapiConfig = { rule: { any: shared.map((rule) => rule.config.rule) } };

    for (const node of root.findAll(combined)) {
      for (const rule of shared)
        if (node.matches(rule.config)) matches.push(toMatch(rule, path, node));
    }
  }

  for (const rule of applicable.filter((r) => !combinable(r))) {
    for (const node of root.findAll(rule.config)) matches.push(toMatch(rule, path, node));
  }

  return matches;
};

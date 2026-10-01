/**
 * One Rules run over a change: secrets (Betterleaks) and patterns (ast-grep)
 * side by side, on the lines the change adds only.
 *
 * - `history` (a pull request): Betterleaks reads the commits `base..head`
 *   itself (`git log -p -U0`, added lines only), so a secret added and then
 *   removed inside the PR is still reported.
 * - `snapshot` (Agent Session Turns): `base` and `head` are checkpoint
 *   commits or trees; both scanners read the changed files at `head` and keep
 *   what overlaps the added lines of `git diff -U0`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RiskFinding } from "@polaris/protocol";
import { type AddedLines, addedLines, overlapsAdded } from "./addedLines.ts";
import { patternFinding, secretFinding } from "./findings.ts";
import { materialize, removeMaterialized } from "./materialize.ts";
import { runPatternScan } from "./patterns/client.ts";
import { builtinPack, languageOf, type PackLanguage } from "./patterns/pack.ts";
import { locateBetterleaks, scanSecrets } from "./secrets/betterleaks.ts";

export type RulesMode = "history" | "snapshot";

export interface RulesRequest {
  /** A checkout of the repository holding `base` and `head`. */
  readonly cwd: string;
  readonly base: string;
  readonly head: string;
  readonly mode: RulesMode;
}

export interface RulesOutcome {
  /** Ranked by nothing yet: in the order found, deduplicated by id. */
  readonly findings: ReadonlyArray<RiskFinding>;
  /** What a user should know about the run (a scanner unavailable, files skipped); empty when clean. */
  readonly notes: ReadonlyArray<string>;
  /** False when both scanners failed: there is nothing to show. */
  readonly ok: boolean;
}

const secretsPart = async (
  request: RulesRequest,
  added: AddedLines,
  dir: string,
  signal: AbortSignal
): Promise<ReadonlyArray<RiskFinding>> => {
  const binary = locateBetterleaks();

  if (binary === null) throw new Error("Betterleaks is not installed beside the Daemon");
  const history = request.mode === "history";

  const scan = history
    ? await scanSecrets(
        binary,
        request.cwd,
        { kind: "history", base: request.base, head: request.head },
        signal
      )
    : await scanSecrets(binary, dir, { kind: "files" }, signal);

  if (scan.state !== "complete") throw new Error(`Betterleaks stopped early (${scan.state})`);

  return scan.hits
    .filter((hit) => history || overlapsAdded(added, hit.path, hit.start, hit.end))
    .map((hit) => secretFinding(hit, history));
};

const patternsPart = async (
  added: AddedLines,
  dir: string,
  paths: ReadonlyArray<string>,
  signal: AbortSignal
): Promise<{ findings: ReadonlyArray<RiskFinding>; skipped: number }> => {
  const files = paths.flatMap((path) => {
    const language = languageOf(path);

    return language === null
      ? []
      : [{ path, language } satisfies { path: string; language: PackLanguage }];
  });

  const reply = await runPatternScan({ root: dir, files }, signal);
  const rules = new Map(builtinPack().map((rule) => [rule.id, rule]));
  const lines = new Map<string, ReadonlyArray<string>>();

  const linesOf = (path: string) => {
    const cached = lines.get(path);

    if (cached !== undefined) return cached;
    const read = readFileSync(join(dir, path), "utf8").split("\n");
    lines.set(path, read);

    return read;
  };

  const findings = reply.matches.flatMap((match) => {
    const rule = rules.get(match.ruleId);

    if (rule === undefined || !overlapsAdded(added, match.path, match.start, match.end)) return [];

    return [patternFinding(rule, match, linesOf(match.path))];
  });

  return { findings, skipped: reply.skipped.length };
};

const dedupe = (findings: ReadonlyArray<RiskFinding>) => [
  ...new Map(findings.map((finding) => [finding.id, finding])).values(),
];

/** Why a scanner failed, as a note: a settled promise's reason is whatever was thrown. */
const failureNote = (label: string, settled: PromiseRejectedResult) =>
  `${label} were not checked: ${settled.reason instanceof Error ? settled.reason.message : String(settled.reason)}`;

export const runRules = async (
  request: RulesRequest,
  signal: AbortSignal = new AbortController().signal
): Promise<RulesOutcome> => {
  const added = await addedLines(request.cwd, request.base, request.head);
  const materialized = await materialize(request.cwd, request.head, [...added.keys()]);
  const { dir, paths } = materialized;

  try {
    const [secrets, patterns] = await Promise.allSettled([
      secretsPart(request, added, dir, signal),
      patternsPart(added, dir, paths, signal),
    ]);

    const notes: Array<string> = [];

    if (secrets.status === "rejected") notes.push(failureNote("Secrets", secrets));

    if (patterns.status === "rejected") {
      notes.push(failureNote("Code patterns", patterns));
    } else if (patterns.value.skipped > 0) {
      notes.push(
        `${patterns.value.skipped} files were too large or unreadable for the pattern rules`
      );
    }

    return {
      findings: dedupe([
        ...(secrets.status === "fulfilled" ? secrets.value : []),
        ...(patterns.status === "fulfilled" ? patterns.value.findings : []),
      ]),
      notes,
      ok: secrets.status === "fulfilled" || patterns.status === "fulfilled",
    };
  } finally {
    removeMaterialized(materialized);
  }
};

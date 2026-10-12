// Portions adapted from antfu/pulls.review@764de3b8cfdc25d3e4012b1ed622e628af88c32e (MIT)
/**
 * The file list's groups (Paper R11): the Walkthrough's Intent Groups when it returned
 * them, else groups by path (docs, code, tests, config, deps, generated). Every file in the
 * Review lands in exactly one group; files the Walkthrough didn't name go to "Other changes".
 */
import { compilePatterns, type IntentCategory, type IntentGroup } from "@polaris/protocol";
import type { Plain } from "../../../store/plain.ts";
import type { ReviewFile, ReviewSection } from "./layout.ts";

export type GroupSource = "walkthrough" | "path";

export interface FileGroup {
  readonly key: string;
  readonly label: string;
  /** The Walkthrough's "why"; null for a group by path. */
  readonly summary: string | null;
  readonly category: IntentCategory;
  readonly critical: boolean;
  readonly files: ReadonlyArray<ReviewFile>;
}

export interface Grouping {
  readonly source: GroupSource;
  readonly groups: ReadonlyArray<FileGroup>;
}

interface PathRule {
  readonly key: string;
  readonly label: string;
  readonly category: IntentCategory;
  readonly matches: (file: ReviewFile) => boolean;
}

const isDocs = compilePatterns(["*.md", "*.mdx", "*.mdc", "docs/", "README*"]);

const isConfig = compilePatterns([
  "*.config.*",
  ".*rc",
  ".*rc.*",
  "/.github/",
  "/.git*",
  "tsconfig*.json",
  "Dockerfile",
  "docker-compose*.y*ml",
  ".dockerignore",
  "Makefile",
]);

const isDeps = compilePatterns([
  "package.json",
  "pnpm-workspace.yaml",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
]);

/** First match wins; the order is also the groups' order. */
const PATH_RULES: ReadonlyArray<PathRule> = [
  { key: "generated", label: "Generated", category: "other", matches: (f) => f.generated },
  { key: "tests", label: "Tests", category: "tests", matches: (f) => f.test },
  { key: "docs", label: "Docs", category: "docs", matches: (f) => isDocs(f.file.path) },
  { key: "config", label: "Config", category: "config", matches: (f) => isConfig(f.file.path) },
  { key: "deps", label: "Dependencies", category: "deps", matches: (f) => isDeps(f.file.path) },
  { key: "code", label: "Code", category: "core", matches: () => true },
];

const DISPLAY_ORDER = ["docs", "code", "tests", "config", "deps", "generated"];

const ruleOf = (file: ReviewFile) => PATH_RULES.find((rule) => rule.matches(file));

/** Groups by path: no Walkthrough yet, or it returned no groups. */
export const pathGroups = (files: ReadonlyArray<ReviewFile>): ReadonlyArray<FileGroup> =>
  DISPLAY_ORDER.flatMap((key) => {
    const rule = PATH_RULES.find((r) => r.key === key);
    const members = files.filter((f) => ruleOf(f)?.key === key);

    if (rule === undefined || members.length === 0) return [];

    return [
      {
        key: `path:${key}`,
        label: rule.label,
        summary: null,
        category: rule.category,
        critical: false,
        files: members,
      },
    ];
  });

/** The Walkthrough's groups over `files`, in its order, then "Other changes" for the rest. */
export const groupFiles = (
  files: ReadonlyArray<ReviewFile>,
  intents: ReadonlyArray<Plain<IntentGroup>> | undefined
): Grouping => {
  if (intents === undefined || intents.length === 0)
    return { source: "path", groups: pathGroups(files) };

  const owner = new Map<string, string>();

  for (const intent of intents)
    for (const path of intent.paths) if (!owner.has(path)) owner.set(path, intent.key);

  const groups: Array<FileGroup> = intents.flatMap((intent) => {
    const members = files.filter((f) => owner.get(f.file.path) === intent.key);

    return members.length === 0
      ? []
      : [
          {
            key: `intent:${intent.key}`,
            label: intent.label,
            summary: intent.summary,
            category: intent.category,
            critical: intent.critical,
            files: members,
          },
        ];
  });

  const rest = files.filter((f) => !owner.has(f.file.path));

  if (rest.length > 0)
    groups.push({
      key: "intent:other",
      label: "Other changes",
      summary: "Changed since the walkthrough was written.",
      category: "other",
      critical: false,
      files: rest,
    });

  return { source: "walkthrough", groups };
};

/**
 * An Agent Session's diff "By intent" (Paper R11b): a section per group, its divider naming
 * the group and the Turns its files come from. Files keep their Turn's patch.
 */
export const intentSections = (
  sections: ReadonlyArray<ReviewSection>,
  grouping: Grouping
): ReadonlyArray<ReviewSection> => {
  const turnOf = new Map(sections.map((s) => [s.id, s.divider?.turn ?? 0]));
  const harness = sections.find((s) => s.divider !== null)?.divider?.harness ?? "";

  return grouping.groups.map((group) => {
    const turns = [...new Set(group.files.map((f) => turnOf.get(f.section) ?? 0))].toSorted(
      (a, b) => a - b
    );

    return {
      id: `group:${group.key}`,
      divider: {
        turn: turns.at(-1) ?? 0,
        harness,
        quote: group.summary,
        intent: {
          label: group.label,
          category: group.category,
          critical: group.critical,
          turns,
        },
      },
      files: group.files,
    };
  });
};

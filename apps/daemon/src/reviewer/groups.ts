// Portions adapted from antfu/pulls.review@764de3b8cfdc25d3e4012b1ed622e628af88c32e (MIT)
/**
 * A Walkthrough's Intent Groups: its last section, one fenced JSON document, decoded
 * with Effect Schema and checked for coverage (every changed path in exactly one group).
 */
import { IntentCategory, IntentGroup } from "@polaris/protocol";
import { Result, Schema } from "effect";

export const GROUPS_HEADING = "## Intent groups";

const CATEGORY_GUIDE = [
  "ui: components, views, styles, layout.",
  "api: endpoints, handlers, contracts between services or packages, third-party integrations.",
  "core: domain logic and internal modules; only when ui/api/data/cli don't fit.",
  "data: schemas, migrations, models, queries, storage.",
  "cli: command-line entry points, argument parsing, terminal output.",
  "security: auth, permissions, secrets handling, input validation.",
  "tests: tests, fixtures, snapshots, stories, benchmarks.",
  "docs: README, guides, changelog, comment-only edits.",
  "examples: examples, playgrounds, demos.",
  "deps: dependency bumps, lockfiles.",
  "build: bundler, compiler and toolchain config, package manifests.",
  "scripts: dev and one-off scripts, automation.",
  "config: runtime config, env, feature flags, linter config, CI/CD, deployment.",
  "i18n: translations, locales.",
  "assets: images, fonts, static files.",
  "other: generated or vendored code, or anything that fits nothing above.",
].join(" ");

const GroupOutput = Schema.Struct({
  key: Schema.String.annotate({ description: 'Short, stable kebab-case id, e.g. "docs".' }),
  label: Schema.String.annotate({ description: "At most four words." }),
  summary: Schema.String.annotate({
    description: "Why this group changes, over what: one to three sentences of Markdown.",
  }),
  category: IntentCategory.annotate({
    description: `Which part of the system the group touches. ${CATEGORY_GUIDE}`,
  }),
  critical: Schema.Boolean.annotate({
    description:
      "True only when the whole group deserves extra care: security, data loss, hard to revert. Most groups are not critical.",
  }),
  paths: Schema.Array(Schema.String).annotate({
    description: "The group's changed paths, exactly as the change lists them.",
  }),
});

const GroupsOutput = Schema.Struct({
  groups: Schema.Array(GroupOutput).annotate({
    description: "Review priority order: the core change first, mechanical changes last.",
  }),
});

const decodeGroups = Schema.decodeUnknownResult(GroupsOutput);

/** The prompt's instructions for the last section. */
export const groupsInstructions = () =>
  [
    `${GROUPS_HEADING}\nEnd with this section: exactly one fenced \`\`\`json block grouping every changed path by intent, matching this JSON Schema:`,
    JSON.stringify(Schema.toJsonSchemaDocument(GroupsOutput).schema),
    [
      "Grouping principles:",
      "- Group by intent, not by directory. One feature touching several modules is one group.",
      "- Use the fewest groups that still separate independent intents; a typical change has one to five.",
      "- Tests, stories and fixtures usually go in a group of their own, apart from the code they cover.",
      "- Order groups by review priority: the core change first, supporting changes next, mechanical changes (lockfiles, generated files, formatting) last.",
      "- Every changed path, generated ones included, goes into exactly one group.",
    ].join("\n"),
  ].join("\n");

export interface SplitWalkthrough {
  readonly markdown: string;
  /** The groups section's text; null when the reply has none. */
  readonly block: string | null;
}

/** The Walkthrough's Markdown without its groups section, and that section. */
export const splitGroups = (markdown: string): SplitWalkthrough => {
  const at = markdown.search(/^## Intent groups\s*$/m);

  if (at < 0) return { markdown, block: null };

  return { markdown: markdown.slice(0, at).trimEnd(), block: markdown.slice(at) };
};

const FENCED = /```(?:json)?\s*\n([\s\S]*?)\n```/g;

interface Coverage {
  readonly missing: ReadonlyArray<string>;
  readonly duplicated: ReadonlyArray<string>;
  readonly unknown: ReadonlyArray<string>;
}

const coverage = (
  groups: ReadonlyArray<{ readonly paths: ReadonlyArray<string> }>,
  paths: ReadonlyArray<string>
): Coverage => {
  const known = new Set(paths);
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  const unknown: Array<string> = [];

  for (const path of groups.flatMap((g) => g.paths)) {
    if (!known.has(path)) unknown.push(path);
    else if (seen.has(path)) duplicated.add(path);
    seen.add(path);
  }

  return { missing: paths.filter((p) => !seen.has(p)), duplicated: [...duplicated], unknown };
};

const describe = (issues: Coverage): string | null => {
  const lines = [
    issues.missing.length > 0 ? `Missing paths: ${issues.missing.join(", ")}` : null,
    issues.duplicated.length > 0 ? `Duplicated paths: ${issues.duplicated.join(", ")}` : null,
    issues.unknown.length > 0 ? `Unknown paths: ${issues.unknown.join(", ")}` : null,
  ].filter((line) => line !== null);

  return lines.length === 0 ? null : lines.join("\n");
};

const parseJson = (text: string): Result.Result<unknown, string> => {
  try {
    return Result.succeed(JSON.parse(text));
  } catch (error) {
    return Result.fail(`The groups were not one JSON document: ${String(error)}`);
  }
};

/** The groups section decoded and covering exactly `paths`, or what was wrong (sent back once). */
export const parseGroups = (
  block: string | null,
  paths: ReadonlyArray<string>
): Result.Result<ReadonlyArray<IntentGroup>, string> => {
  if (block === null) return Result.fail(`The walkthrough had no "${GROUPS_HEADING}" section.`);
  const document = [...block.matchAll(FENCED)].at(-1)?.[1];

  if (document === undefined) return Result.fail("The groups section had no fenced JSON block.");

  return parseJson(document).pipe(
    Result.flatMap((json) => Result.mapError(decodeGroups(json), (error) => error.message)),
    Result.flatMap((output) => {
      const problem = describe(coverage(output.groups, paths));

      return problem === null
        ? Result.succeed(
            output.groups
              .filter((g) => g.paths.length > 0)
              .map((g) => IntentGroup.make({ ...g, paths: [...g.paths] }))
          )
        : Result.fail(problem);
    })
  );
};

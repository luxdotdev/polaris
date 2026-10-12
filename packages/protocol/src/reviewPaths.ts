// Portions adapted from brandonmcconnell/geld@7abdccb (MIT): the glob matcher and the test and generated pattern lists.
/**
 * Which changed files Review treats as noise: generated files (lockfiles, build output,
 * generator output) and test files. Paths only, never contents; the Daemon adds the repo's
 * `.gitattributes` and `.polaris/review.md` `ignore:` on top (`DiffFile.generated`).
 */

/** `*.spec.*` stays on code extensions: OpenAPI documents are often named `api.spec.yaml`. */
const CODE =
  "{js,jsx,ts,tsx,mjs,cjs,mts,cts,vue,svelte,astro,py,rb,php,dart,kt,kts,swift,scala,sc,ex,exs,lua,cs,fs,fsx,go,rs,java,groovy,clj,cljs,cljc,coffee,res,ml,re,hs,zig,nim,jl,r,R,m,mm,sh,bash,zsh,ps1,sql,elm,gleam,erl,pl,pm,c,cc,cpp,cxx,h,hpp,cu}";

/** Lockfiles and files a tool writes, gitignore-style (see `compilePatterns`). */
export const GENERATED_PATTERNS: ReadonlyArray<string> = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "pdm.lock",
  "composer.lock",
  "go.sum",
  "mix.lock",
  "pubspec.lock",
  "Podfile.lock",
  "Package.resolved",
  "packages.lock.json",
  "flake.lock",
  "gradle.lockfile",
  "*.generated.*",
  "*.gen.*",
  "*.g.dart",
  "*.freezed.dart",
  "*.pb.*",
  "*_pb2.py",
  "*_pb2_grpc.py",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.bundle.js",
  "*.tsbuildinfo",
  "__generated__/",
  ".generated/",
  "dist/",
];

/** Files that exist to test other files: unit, end-to-end, test directories, snapshots, runner config. */
export const TEST_PATTERNS: ReadonlyArray<string> = [
  "*.test.*",
  "*.tests.*",
  "*.testing.*",
  `*.spec.${CODE}`,
  `*.specs.${CODE}`,
  `*.unit.${CODE}`,
  `*.integration.${CODE}`,
  "*_test.*",
  "*_tests.*",
  `*_spec.${CODE}`,
  "test_*.*",
  "tests_*.*",
  "*Test.{java,kt,kts,scala,groovy,php,cs,swift,dart}",
  "*Tests.{java,kt,kts,scala,groovy,php,cs,swift,dart}",
  "*TestCase.{java,kt,php,py,cs,swift}",
  "*Spec.{java,kt,kts,scala,groovy,js,ts}",
  "*IT.java",
  "*.bats",
  "*.feature",
  "*.e2e.*",
  "*.e2e-spec.*",
  "*.e2e-test.*",
  "*.cy.*",
  "*.pw.*",
  "e2e/",
  "cypress/",
  "playwright/",
  "integration-tests/",
  "integration_tests/",
  "test/",
  "tests/",
  "__tests__/",
  "__test__/",
  "__mocks__/",
  "testdata/",
  "test-data/",
  "test_data/",
  "test-utils/",
  "test_utils/",
  "testutils/",
  "test-helpers/",
  "test_helpers/",
  "Tests/",
  "*.Tests/",
  "*.UnitTests/",
  "*.IntegrationTests/",
  "androidTest/",
  "testFixtures/",
  "*.snap",
  "__snapshots__/",
  "__image_snapshots__/",
  "cassettes/",
  "__recordings__/",
  "jest.config.*",
  "jest.setup.*",
  "vitest.config.*",
  "vitest.setup.*",
  "vitest.workspace.*",
  "playwright.config.*",
  "cypress.config.*",
  "karma.conf.*",
  ".mocharc*",
  "wdio.conf.*",
  "setupTests.*",
  "test-setup.*",
  "pytest.ini",
  "conftest.py",
  "phpunit.xml",
  "phpunit.xml.dist",
  ".rspec",
  "spec_helper.rb",
  "rails_helper.rb",
  "test_helper.rb",
];

const splitAlternatives = (body: string): ReadonlyArray<string> => {
  const parts: Array<string> = [];
  let depth = 0;
  let current = "";

  for (const char of body) {
    if (char === "{") depth += 1;

    if (char === "}") depth -= 1;

    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);

  return parts;
};

const closingBrace = (pattern: string, open: number): number => {
  let depth = 0;

  for (let at = open; at < pattern.length; at++) {
    if (pattern[at] === "{") depth += 1;

    if (pattern[at] === "}" && --depth === 0) return at;
  }

  return -1;
};

/** `{a,b}` groups expanded into plain globs. */
export const expandBraces = (pattern: string): ReadonlyArray<string> => {
  const open = pattern.indexOf("{");
  const close = open === -1 ? -1 : closingBrace(pattern, open);

  if (close === -1) return [pattern];
  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);

  return splitAlternatives(pattern.slice(open + 1, close)).flatMap((alternative) =>
    expandBraces(alternative + suffix).map((tail) => prefix + tail)
  );
};

const escape = (char: string) => char.replace(/[\\^$.+()|[\]{}]/g, "\\$&");

const characterClass = (segment: string, at: number): readonly [string, number] | null => {
  const end = segment.indexOf("]", at + 1);

  if (end === -1) return null;
  const body = segment.slice(at + 1, end);

  return [`[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`, end];
};

const segmentSource = (segment: string): string => {
  let source = "";

  for (let at = 0; at < segment.length; at++) {
    const char = segment[at] ?? "";
    const range = char === "[" ? characterClass(segment, at) : null;

    if (range !== null) {
      source += range[0];
      at = range[1];
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += escape(char);
  }

  return source;
};

/** A brace-free glob as regular expression source, with gitignore's anchoring. */
const globSource = (glob: string): string => {
  let pattern = glob.trim().replace(/^\//, "");
  const directory = pattern.endsWith("/");

  if (directory) pattern = pattern.slice(0, -1);

  if ((directory || !pattern.includes("/")) && !pattern.startsWith("**/"))
    pattern = `**/${pattern}`;

  const segments = pattern.split("/");

  const body = segments
    .map((segment, i) => {
      const last = i === segments.length - 1;

      if (segment === "**") return last ? ".*" : "(?:[^/]+/)*";

      return last ? segmentSource(segment) : `${segmentSource(segment)}/`;
    })
    .join("");

  return directory ? `${body}(?:/.*)?` : body;
};

/**
 * One matcher for a list of gitignore-style patterns: a pattern without a slash matches a
 * file name at any depth, a trailing slash a directory at any depth, `**` spans directories,
 * `{a,b}` alternates, and `!pattern` rescues a path. Blank lines and `#` comments are skipped.
 */
export const compilePatterns = (patterns: ReadonlyArray<string>): ((path: string) => boolean) => {
  const lines = patterns.flatMap((p) => {
    const line = p.trim();

    return line === "" || line.startsWith("#") ? [] : [line];
  });

  const compile = (globs: ReadonlyArray<string>) =>
    globs.length === 0
      ? null
      : new RegExp(`^(?:${globs.flatMap(expandBraces).map(globSource).join("|")})$`);

  const include = compile(lines.filter((p) => !p.startsWith("!")));

  const exclude = compile(lines.flatMap((p) => (p.startsWith("!") ? [p.slice(1)] : [])));

  return (path) => {
    const normalized = path.replace(/\\/g, "/").replace(/^\.?\//, "");

    return include !== null && include.test(normalized) && !(exclude?.test(normalized) ?? false);
  };
};

/** A lockfile or a file a tool writes, by its path alone. */
export const isGeneratedPath: (path: string) => boolean = compilePatterns(GENERATED_PATTERNS);

/** A test, snapshot, fixture or test runner config, by its path alone. */
export const isTestPath: (path: string) => boolean = compilePatterns(TEST_PATTERNS);

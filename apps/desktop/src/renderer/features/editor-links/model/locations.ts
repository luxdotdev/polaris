/**
 * `path:line` (and `path:line:column`) in prose, as agents write them: "see src/hosts/reconnect.ts:28".
 * A match needs a folder or a code file's extension, so "localhost:3000" and times stay text.
 */

export interface FoundLocation {
  readonly start: number;
  readonly end: number;
  readonly path: string;
  readonly line: number;
  readonly column: number | null;
}

const PATTERN =
  /(?<![\w/.:@-])((?:~|\.{1,2})?\/?(?:[\w@.-]+\/)*[\w@.-]+\.([A-Za-z][\w]{0,9})):(\d+)(?::(\d+))?(?![\w:])/g;

/** Extensions that make a bare name (no folder) a file: code, config, docs. */
const BARE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "json",
  "css",
  "scss",
  "html",
  "md",
  "mdx",
  "py",
  "rs",
  "go",
  "rb",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "php",
  "sh",
  "zsh",
  "bash",
  "toml",
  "yaml",
  "yml",
  "sql",
  "qnt",
  "vue",
  "svelte",
  "lua",
  "zig",
  "ex",
  "exs",
  "erl",
  "hs",
  "ml",
  "scala",
  "dart",
  "proto",
  "graphql",
  "txt",
]);

export const findLocations = (text: string): Array<FoundLocation> => {
  const found: Array<FoundLocation> = [];

  for (const match of text.matchAll(PATTERN)) {
    const [whole, path = "", extension = "", line = "", column] = match;
    const inFolder = path.includes("/");

    if (!inFolder && !BARE_EXTENSIONS.has(extension.toLowerCase())) continue;
    const start = match.index;

    found.push({
      start,
      end: start + whole.length,
      path,
      line: Number(line),
      column: column === undefined ? null : Number(column),
    });
  }

  return found;
};

/** The whole of `text` is one location (an inline code span holding just `path:line`). */
export const wholeLocation = (text: string): FoundLocation | null => {
  const found = findLocations(text.trim());

  return found.length === 1 && found[0]?.start === 0 && found[0].end === text.trim().length
    ? found[0]
    : null;
};

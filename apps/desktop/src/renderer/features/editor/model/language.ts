/**
 * Which grammar a file gets, from its name: the spec's languages (§4), each
 * lazy-loaded by `cm/languages.ts`, and plain text for everything else.
 */
export type LanguageId =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "json"
  | "css"
  | "html"
  | "markdown"
  | "python"
  | "rust"
  | "go"
  | "yaml"
  | "toml"
  | "sql"
  | "shell"
  | "plain";

/** The status bar's name for each language (DESIGN.md, Editor: status bar). */
export const LANGUAGE_NAMES: Readonly<Record<LanguageId, string>> = {
  typescript: "TypeScript",
  tsx: "TypeScript JSX",
  javascript: "JavaScript",
  jsx: "JavaScript JSX",
  json: "JSON",
  css: "CSS",
  html: "HTML",
  markdown: "Markdown",
  python: "Python",
  rust: "Rust",
  go: "Go",
  yaml: "YAML",
  toml: "TOML",
  sql: "SQL",
  shell: "Shell",
  plain: "Plain text",
};

const BY_EXTENSION = new Map<string, LanguageId>(
  Object.entries({
    ts: "typescript",
    mts: "typescript",
    cts: "typescript",
    tsx: "tsx",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "jsx",
    json: "json",
    jsonc: "json",
    json5: "json",
    css: "css",
    html: "html",
    htm: "html",
    md: "markdown",
    mdx: "markdown",
    markdown: "markdown",
    py: "python",
    pyi: "python",
    rs: "rust",
    go: "go",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    fish: "shell",
  } satisfies Record<string, LanguageId>)
);

const BY_NAME = new Map<string, LanguageId>(
  Object.entries({
    ".bashrc": "shell",
    ".zshrc": "shell",
    ".profile": "shell",
    ".envrc": "shell",
    "bun.lock": "json",
    "cargo.lock": "toml",
    ".prettierrc": "json",
    ".oxlintrc": "json",
  } satisfies Record<string, LanguageId>)
);

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The grammar for a path; `firstLine` catches scripts by their shebang. */
export const languageFor = (path: string, firstLine = ""): LanguageId => {
  const name = baseName(path).toLowerCase();
  const named = BY_NAME.get(name);

  if (named !== undefined) return named;
  const dot = name.lastIndexOf(".");
  const byExtension = dot > 0 ? BY_EXTENSION.get(name.slice(dot + 1)) : undefined;

  if (byExtension !== undefined) return byExtension;

  return /^#!.*\b(?:ba|z|fi)?sh\b/.test(firstLine) ? "shell" : "plain";
};

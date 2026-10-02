/** Local syntax metadata, independent of Host tooling, trust and Connection State. */
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
  | "gomod"
  | "gowork"
  | "yaml"
  | "toml"
  | "sql"
  | "shell"
  | "dotenv"
  | "prisma"
  | "java"
  | "php"
  | "lua"
  | "c"
  | "cpp"
  | "csharp"
  | "ruby"
  | "xml"
  | "dockerfile"
  | "ini"
  | "diff"
  | "plain";

export interface LanguageMetadata {
  readonly name: string;
  readonly documentLanguageId: string;
  readonly extensions: readonly string[];
  readonly aliases: readonly string[];
  readonly filenames: readonly string[];
}

/** Settings and manual selection can use the same IDs and associations as syntax. */
export interface LanguageAssociation {
  readonly language: LanguageId;
  readonly filenames?: readonly string[];
  readonly extensions?: readonly string[];
}

export const LANGUAGES: Readonly<Record<LanguageId, LanguageMetadata>> = {
  typescript: {
    name: "TypeScript",
    documentLanguageId: "typescript",
    extensions: ["ts", "mts", "cts"],
    aliases: ["ts", "typescript"],
    filenames: [],
  },
  tsx: {
    name: "TypeScript JSX",
    documentLanguageId: "typescriptreact",
    extensions: ["tsx"],
    aliases: ["tsx", "typescriptreact"],
    filenames: [],
  },
  javascript: {
    name: "JavaScript",
    documentLanguageId: "javascript",
    extensions: ["js", "mjs", "cjs"],
    aliases: ["js", "javascript"],
    filenames: [],
  },
  jsx: {
    name: "JavaScript JSX",
    documentLanguageId: "javascriptreact",
    extensions: ["jsx"],
    aliases: ["jsx", "javascriptreact"],
    filenames: [],
  },
  json: {
    name: "JSON",
    documentLanguageId: "json",
    extensions: ["json", "jsonc", "json5"],
    aliases: ["json", "jsonc", "json5"],
    filenames: ["bun.lock", ".prettierrc", ".oxlintrc", ".eslintrc"],
  },
  css: {
    name: "CSS",
    documentLanguageId: "css",
    extensions: ["css"],
    aliases: ["css"],
    filenames: [],
  },
  html: {
    name: "HTML",
    documentLanguageId: "html",
    extensions: ["html", "htm"],
    aliases: ["html"],
    filenames: [],
  },
  markdown: {
    name: "Markdown",
    documentLanguageId: "markdown",
    extensions: ["md", "mdx", "markdown"],
    aliases: ["md", "markdown", "mdx"],
    filenames: [],
  },
  python: {
    name: "Python",
    documentLanguageId: "python",
    extensions: ["py", "pyi", "pyw"],
    aliases: ["py", "python"],
    filenames: [],
  },
  rust: {
    name: "Rust",
    documentLanguageId: "rust",
    extensions: ["rs"],
    aliases: ["rs", "rust"],
    filenames: [],
  },
  go: {
    name: "Go",
    documentLanguageId: "go",
    extensions: ["go"],
    aliases: ["go", "golang"],
    filenames: [],
  },
  gomod: {
    name: "Go module",
    documentLanguageId: "gomod",
    extensions: [],
    aliases: ["gomod", "go.mod"],
    filenames: ["go.mod"],
  },
  gowork: {
    name: "Go workspace",
    documentLanguageId: "gowork",
    extensions: [],
    aliases: ["gowork", "go.work"],
    filenames: ["go.work"],
  },
  yaml: {
    name: "YAML",
    documentLanguageId: "yaml",
    extensions: ["yaml", "yml"],
    aliases: ["yaml", "yml", "github-actions"],
    filenames: [],
  },
  toml: {
    name: "TOML",
    documentLanguageId: "toml",
    extensions: ["toml"],
    aliases: ["toml"],
    filenames: ["cargo.lock"],
  },
  sql: {
    name: "SQL",
    documentLanguageId: "sql",
    extensions: ["sql"],
    aliases: ["sql", "postgres", "postgresql", "mysql", "sqlite"],
    filenames: [],
  },
  shell: {
    name: "Shell",
    documentLanguageId: "shellscript",
    extensions: ["sh", "bash", "zsh", "fish"],
    aliases: ["sh", "bash", "shell", "shellscript", "zsh", "fish"],
    filenames: [".bashrc", ".bash_profile", ".zshrc", ".zprofile", ".profile", ".envrc"],
  },
  dotenv: {
    name: "Dotenv",
    documentLanguageId: "dotenv",
    extensions: ["env"],
    aliases: ["env", "dotenv"],
    filenames: [".env"],
  },
  prisma: {
    name: "Prisma",
    documentLanguageId: "prisma",
    extensions: ["prisma"],
    aliases: ["prisma"],
    filenames: [],
  },
  java: {
    name: "Java",
    documentLanguageId: "java",
    extensions: ["java"],
    aliases: ["java"],
    filenames: [],
  },
  php: {
    name: "PHP",
    documentLanguageId: "php",
    extensions: ["php", "phtml", "php3", "php4", "php5", "php7", "php8"],
    aliases: ["php"],
    filenames: [],
  },
  lua: {
    name: "Lua",
    documentLanguageId: "lua",
    extensions: ["lua"],
    aliases: ["lua"],
    filenames: [],
  },
  c: { name: "C", documentLanguageId: "c", extensions: ["c", "h"], aliases: ["c"], filenames: [] },
  cpp: {
    name: "C++",
    documentLanguageId: "cpp",
    extensions: ["cpp", "cc", "cxx", "hpp", "hh", "hxx"],
    aliases: ["cpp", "c++"],
    filenames: [],
  },
  csharp: {
    name: "C#",
    documentLanguageId: "csharp",
    extensions: ["cs"],
    aliases: ["cs", "csharp", "c#"],
    filenames: [],
  },
  ruby: {
    name: "Ruby",
    documentLanguageId: "ruby",
    extensions: ["rb", "rake", "gemspec"],
    aliases: ["ruby", "rb"],
    filenames: ["gemfile", "rakefile"],
  },
  xml: {
    name: "XML",
    documentLanguageId: "xml",
    extensions: ["xml", "svg", "xsl", "xslt", "xsd", "plist"],
    aliases: ["xml", "svg"],
    filenames: [],
  },
  dockerfile: {
    name: "Dockerfile",
    documentLanguageId: "dockerfile",
    extensions: ["dockerfile"],
    aliases: ["dockerfile", "docker"],
    filenames: ["dockerfile", "containerfile"],
  },
  ini: {
    name: "INI",
    documentLanguageId: "ini",
    extensions: ["ini", "cfg", "conf", "properties"],
    aliases: ["ini", "properties"],
    filenames: [".editorconfig"],
  },
  diff: {
    name: "Diff",
    documentLanguageId: "diff",
    extensions: ["diff", "patch"],
    aliases: ["diff", "patch"],
    filenames: [],
  },
  plain: {
    name: "Plain text",
    documentLanguageId: "plaintext",
    extensions: ["txt", "text"],
    aliases: ["text", "plaintext", "plain"],
    filenames: [],
  },
};

// SAFETY: the keys are exactly the LanguageId keys of the typed metadata record.
export const LANGUAGE_IDS = Object.keys(LANGUAGES) as LanguageId[];

/** The status bar's names (DESIGN.md, Editor: status bar). */
// SAFETY: every LanguageId is mapped once to its metadata name.
export const LANGUAGE_NAMES = Object.fromEntries(
  LANGUAGE_IDS.map((id) => [id, LANGUAGES[id].name])
) as Readonly<Record<LanguageId, string>>;

const BY_EXTENSION = new Map<string, LanguageId>();

const BY_NAME = new Map<string, LanguageId>();

const BY_ALIAS = new Map<string, LanguageId>();

for (const id of LANGUAGE_IDS) {
  const metadata = LANGUAGES[id];

  for (const extension of metadata.extensions) BY_EXTENSION.set(extension, id);

  for (const filename of metadata.filenames) BY_NAME.set(filename, id);

  for (const alias of [id, metadata.name.toLowerCase(), ...metadata.aliases])
    BY_ALIAS.set(alias, id);
}

export const baseName = (path: string) =>
  path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

/** Exact aliases only: an unknown Markdown fence must remain plain. */
export const languageByName = (name: string): LanguageId | undefined =>
  BY_ALIAS.get(name.toLowerCase());

/** The grammar for a path; firstLine catches extensionless scripts by their shebang. */
export const languageFor = (path: string, firstLine = ""): LanguageId => {
  const name = baseName(path).toLowerCase();
  const named = BY_NAME.get(name);

  if (named !== undefined) return named;

  if (name.startsWith(".env.")) return "dotenv";

  if (/^(?:dockerfile|containerfile)\./.test(name)) return "dockerfile";
  const dot = name.lastIndexOf(".");
  const byExtension = dot > 0 ? BY_EXTENSION.get(name.slice(dot + 1)) : undefined;

  if (byExtension !== undefined) return byExtension;

  if (!firstLine.startsWith("#!")) return "plain";

  if (/\b(?:ba|z|fi|da|k)?sh\b/.test(firstLine)) return "shell";

  if (/\bpython(?:\d+(?:\.\d+)*)?\b/.test(firstLine)) return "python";

  if (/\b(?:node|bun|deno)\b/.test(firstLine)) return "javascript";

  if (/\bruby\b/.test(firstLine)) return "ruby";

  if (/\bphp\b/.test(firstLine)) return "php";

  if (/\blua(?:\d+(?:\.\d+)*)?\b/.test(firstLine)) return "lua";

  return "plain";
};

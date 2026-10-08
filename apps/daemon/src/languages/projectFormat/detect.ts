import { opendir, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { LanguageProjectFormatter, type LanguageProjectFormatterTool } from "@polaris/protocol";
import { Option, Schema } from "effect";
import { within } from "../trust/checkout.ts";
import { ignoreMatcher } from "./ignore.ts";
import { readCapped } from "./read.ts";

interface ToolFacts {
  readonly tool: LanguageProjectFormatterTool;
  readonly configs: readonly string[];
  readonly dependency: string;
  readonly bin: string;
  readonly ignoreFiles: readonly string[];
}

const configs = (stem: string, extensions: readonly string[]) =>
  extensions.map((extension) => `${stem}.${extension}`);

const SCRIPTS = ["ts", "mts", "cts", "js", "mjs", "cjs"];

/** Within one directory, the earlier tool wins. */
export const PROJECT_FORMATTERS: readonly ToolFacts[] = [
  {
    tool: "oxfmt",
    configs: [".oxfmtrc.json", ".oxfmtrc.jsonc", "oxfmt.json", ...configs("oxfmt.config", SCRIPTS)],
    dependency: "oxfmt",
    bin: "oxfmt",
    ignoreFiles: [".prettierignore", ".gitignore"],
  },
  {
    tool: "biome",
    configs: ["biome.json", "biome.jsonc"],
    dependency: "@biomejs/biome",
    bin: "biome",
    ignoreFiles: [],
  },
  {
    tool: "dprint",
    configs: ["dprint.json", ".dprint.json", "dprint.jsonc", ".dprint.jsonc"],
    dependency: "dprint",
    bin: "dprint",
    ignoreFiles: [],
  },
  {
    tool: "prettier",
    configs: [
      ".prettierrc",
      ...configs(".prettierrc", ["json", "json5", "yaml", "yml", "toml", ...SCRIPTS]),
      ...configs("prettier.config", SCRIPTS),
    ],
    dependency: "prettier",
    bin: "prettier",
    ignoreFiles: [".prettierignore"],
  },
];

const factsOf = (tool: LanguageProjectFormatterTool) =>
  PROJECT_FORMATTERS.find((facts) => facts.tool === tool)!;

const PackageJson = Schema.Struct({
  prettier: Schema.optionalKey(Schema.Unknown),
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

const MAX_MANIFEST_BYTES = 1024 * 1024;

const MAX_IGNORE_BYTES = 256 * 1024;

const MAX_ENTRIES = 20_000;

const CONFIG_NAMES = new Set([
  "package.json",
  ...PROJECT_FORMATTERS.flatMap((facts) => facts.configs),
]);

/** The config names present, reading at most `MAX_ENTRIES` names of a directory. */
const entries = async (directory: string) => {
  const found = new Set<string>();

  try {
    let read = 0;

    for await (const entry of await opendir(directory)) {
      if (CONFIG_NAMES.has(entry.name)) found.add(entry.name);

      if (++read >= MAX_ENTRIES) break;
    }
  } catch {
    /* Unreadable directories have no config. */
  }

  return found;
};

const manifest = async (directory: string) => {
  const text = await readCapped(join(directory, "package.json"), MAX_MANIFEST_BYTES);

  if (text === null) return null;

  try {
    return Option.getOrNull(Schema.decodeUnknownOption(PackageJson)(JSON.parse(text)));
  } catch {
    return null;
  }
};

/** The directories from the file's up to the checkout root, nearest first. */
export const ancestors = (root: string, file: string) => {
  const found: string[] = [];

  for (let directory = dirname(file); within(root, directory); directory = dirname(directory)) {
    found.push(directory);

    if (directory === root || dirname(directory) === directory) break;
  }

  return found;
};

interface Found {
  readonly tool: LanguageProjectFormatterTool;
  readonly root: string;
  readonly config: string | null;
}

const configIn = async (directory: string): Promise<Found | null> => {
  const names = await entries(directory);

  for (const facts of PROJECT_FORMATTERS) {
    const config = facts.configs.find((name) => names.has(name));

    if (config !== undefined)
      return { tool: facts.tool, root: directory, config: join(directory, config) };
  }

  if (!names.has("package.json")) return null;
  const pkg = await manifest(directory);

  return pkg?.prettier === undefined
    ? null
    : { tool: "prettier", root: directory, config: join(directory, "package.json") };
};

const dependencyIn = async (directory: string): Promise<Found | null> => {
  const pkg = await manifest(directory);

  if (pkg === null) return null;
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  const facts = PROJECT_FORMATTERS.find((entry) => Object.hasOwn(declared, entry.dependency));

  return facts === undefined ? null : { tool: facts.tool, root: directory, config: null };
};

/** The tool's binary in the nearest `node_modules/.bin` from its root up to the checkout's. */
export const formatterBinary = async (
  checkoutRoot: string,
  formatterRoot: string,
  tool: LanguageProjectFormatterTool
) => {
  const bin = factsOf(tool).bin;

  for (const directory of ancestors(checkoutRoot, join(formatterRoot, "_"))) {
    const candidate = join(directory, "node_modules", ".bin", bin);

    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      /* Not installed at this level. */
    }
  }

  return null;
};

const ignoredBy = async (found: Found, file: string) => {
  const path = relative(found.root, file).split(sep).join("/");

  if (path.split("/").includes("node_modules")) return true;

  for (const name of factsOf(found.tool).ignoreFiles) {
    const text = await readCapped(join(found.root, name), MAX_IGNORE_BYTES);

    if (text !== null && ignoreMatcher(text)(path)) return true;
  }

  return false;
};

/**
 * Reads files only, never runs them: the nearest config wins, else the nearest package that
 * depends on a formatter. Both paths must be canonical, the file within the checkout.
 */
export async function detectProjectFormatter(
  checkoutRoot: string,
  file: string
): Promise<LanguageProjectFormatter | null> {
  const directories = ancestors(checkoutRoot, file);
  let dependency: Found | null = null;
  let found: Found | null = null;

  for (const directory of directories) {
    found = await configIn(directory);

    if (found !== null) break;
    dependency ??= await dependencyIn(directory);
  }

  found ??= dependency;

  if (found === null) return null;

  return LanguageProjectFormatter.make({
    tool: found.tool,
    root: found.root,
    config: found.config,
    installed: (await formatterBinary(checkoutRoot, found.root, found.tool)) !== null,
    ignored: await ignoredBy(found, file),
  });
}

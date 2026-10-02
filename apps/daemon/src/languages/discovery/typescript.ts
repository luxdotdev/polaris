import { dirname, join, resolve } from "node:path";
import { Schema } from "effect";
import { ancestors, existing, readJson, readText } from "./files.ts";
import { invalid } from "../trust/checkout.ts";

const Package = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
});

const Config = Schema.Struct({
  extends: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(16))])
  ),
  compilerOptions: Schema.optionalKey(
    Schema.Struct({
      plugins: Schema.optionalKey(
        Schema.Array(Schema.Struct({ name: Schema.String })).check(Schema.isMaxLength(64))
      ),
    })
  ),
});

function quotedEnd(text: string, start: number) {
  let escaped = false;

  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === '"' && !escaped) return index;
    escaped = text[index] === "\\" && !escaped;
  }

  throw invalid("Unterminated config string");
}

function commentEnd(text: string, start: number) {
  if (text.slice(start, start + 2) === "//") {
    const end = text.indexOf("\n", start + 2);

    return end < 0 ? text.length : end;
  }

  if (text.slice(start, start + 2) !== "/*") return null;

  const end = text.indexOf("*/", start + 2);

  if (end < 0) throw invalid("Unterminated config comment");

  return end + 1;
}

function trailingComma(text: string, start: number) {
  for (let index = start + 1; index < text.length; index++) {
    const end = commentEnd(text, index);

    if (end !== null) index = end;
    else if (!/\s/.test(text[index]!)) return text[index] === "}" || text[index] === "]";
  }

  return false;
}

/** Preserve strings while removing JSONC comments and trailing commas, without importing config. */
export function jsonc(text: string): typeof Schema.Json.Type {
  let output = "";

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    const end = commentEnd(text, index);

    if (char === '"') {
      const last = quotedEnd(text, index);

      output += text.slice(index, last + 1);
      index = last;
    } else if (end !== null) {
      output += " ";
      index = end;
    } else if (char !== "," || !trailingComma(text, index)) {
      output += char;
    }
  }

  return Schema.decodeUnknownSync(Schema.Json)(JSON.parse(output.replace(/^\uFEFF/, "")));
}

export async function packageDirectory(root: string, start: string, name: string) {
  if (!/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(name) || name === "." || name === "..") {
    throw invalid("Invalid package probe name");
  }

  for (const directory of ancestors(root, start)) {
    const manifest = await existing(root, join(directory, "node_modules", name, "package.json"));

    if (manifest !== null) return dirname(manifest);
  }

  return null;
}

async function extendedPath(root: string, config: string, name: string) {
  if (name.startsWith(".")) {
    const path = resolve(dirname(config), name);

    return (await existing(root, path)) ?? (await existing(root, `${path}.json`));
  }

  const parts = name.split("/");
  const packageName = name.startsWith("@") ? parts.splice(0, 2).join("/") : parts.shift()!;
  const directory = await packageDirectory(root, dirname(config), packageName);

  if (directory === null) return null;
  const suffix = parts.join("/") || "tsconfig.json";

  return (
    (await existing(root, join(directory, suffix))) ??
    (await existing(root, join(directory, `${suffix}.json`)))
  );
}

async function inheritedPlugins(
  root: string,
  path: string,
  seen = new Set<string>(),
  budget = { remaining: 32 }
): Promise<string[] | undefined> {
  if (--budget.remaining < 0) throw invalid("TypeScript config graph exceeds limit");

  if (seen.has(path) || seen.size >= 16) throw invalid("TypeScript config cycle or depth limit");
  seen.add(path);
  const config = Schema.decodeUnknownSync(Config)(jsonc(await readText(path)));
  const bases = config.extends === undefined ? [] : [config.extends].flat();
  let names: string[] | undefined;

  for (const base of bases) {
    const parent = await extendedPath(root, path, base);

    if (parent === null) throw invalid("TypeScript extended config is missing");
    names = (await inheritedPlugins(root, parent, new Set(seen), budget)) ?? names;
  }

  return config.compilerOptions?.plugins?.map(({ name }) => name) ?? names;
}

export async function configPlugins(root: string, path: string): Promise<string[]> {
  return (await inheritedPlugins(root, path)) ?? [];
}

export async function typescriptSdk(root: string, project: string) {
  let directory = await packageDirectory(root, project, "typescript");

  if (directory === null) return null;

  for (let depth = 0; depth < 4; depth++) {
    const manifest = Schema.decodeUnknownSync(Package)(
      await readJson(join(directory, "package.json"))
    );

    const server = await existing(root, join(directory, "lib", "tsserver.js"));

    if (server !== null) return { sdk: directory, server, version: manifest.version ?? null };
    const dependency = await packageDirectory(root, directory, "typescript");

    if (dependency === null || dependency === directory) return null;
    directory = dependency;
  }

  throw invalid("TypeScript SDK alias depth exceeded");
}

export async function pluginFacts(
  root: string,
  probes: readonly string[],
  names: readonly string[]
) {
  const facts: { name: string; packagePath: string | null }[] = [];

  for (const name of names) {
    let packagePath: string | null = null;

    for (const probe of probes) {
      packagePath = await packageDirectory(root, probe, name);

      if (packagePath !== null) break;
    }

    facts.push({ name, packagePath });
  }

  return facts;
}

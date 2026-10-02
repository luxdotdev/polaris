import { realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Schema } from "effect";
import { ancestors, existing, nearest, readText } from "./files.ts";
import { invalid } from "../trust/checkout.ts";
import { jsonc } from "./typescript.ts";

const Environment = Schema.Struct({
  venvPath: Schema.optionalKey(Schema.String),
  venv: Schema.optionalKey(Schema.String),
  extends: Schema.optionalKey(Schema.String),
});

const Pyproject = Schema.Struct({
  tool: Schema.optionalKey(Schema.Struct({ pyright: Schema.optionalKey(Environment) })),
});

async function configuredEnvironment(
  root: string,
  path: string,
  seen = new Set<string>()
): Promise<{ directory: string; environment: typeof Environment.Type }> {
  if (seen.has(path) || seen.size >= 16) throw invalid("Python config cycle or depth limit");
  seen.add(path);
  const text = await readText(path);

  const config = path.endsWith(".toml")
    ? (Schema.decodeUnknownSync(Pyproject)(Bun.TOML.parse(text)).tool?.pyright ?? {})
    : Schema.decodeUnknownSync(Environment)(jsonc(text));

  const local = {
    ...config,
    ...(config.venvPath !== undefined
      ? { venvPath: resolve(dirname(path), config.venvPath) }
      : config.venv !== undefined
        ? { venvPath: dirname(path) }
        : {}),
  };

  if (config.extends === undefined) return { directory: dirname(path), environment: local };
  const extended = await existing(root, resolve(dirname(path), config.extends));

  if (extended === null) throw invalid("Python extended configuration is missing");
  const parent = await configuredEnvironment(root, extended, seen);

  return { directory: dirname(path), environment: { ...parent.environment, ...local } };
}

async function interpreter(root: string, path: string) {
  const parent = await existing(root, dirname(path));

  if (parent === null) return null;

  try {
    // Preserve the venv entry path; its executable may symlink to a Host runtime.
    return { path, target: await realpath(path) };
  } catch (error) {
    if (Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }))(error)) return null;
    throw error;
  }
}

export async function pythonInterpreter(root: string, start: string, platform: NodeJS.Platform) {
  const executable = platform === "win32" ? "Scripts/python.exe" : "bin/python";
  const directories = ancestors(root, start);
  const config = await nearest(root, directories, ["pyrightconfig.json", "pyproject.toml"]);

  if (config !== null) {
    const { directory, environment } = await configuredEnvironment(root, config.path);

    if (environment.venv !== undefined) {
      const path = resolve(directory, environment.venvPath ?? ".", environment.venv, executable);
      const configured = await interpreter(root, path);

      if (configured === null) throw invalid("Configured Python environment is missing");

      return { ...configured, configuration: config.path };
    }
  }

  for (const directory of directories) {
    for (const environment of [".venv", "venv"]) {
      const found = await interpreter(root, join(directory, environment, executable));

      if (found !== null) return { ...found, configuration: config?.path ?? null };
    }
  }

  return { path: null, target: null, configuration: config?.path ?? null };
}

import { join } from "node:path";
import { Schema } from "effect";
import { ancestors, existing, nearest, readJson } from "./files.ts";

interface RootRules {
  readonly [provider: string]: readonly string[];
}

const PRISMA_CONFIGS = ["ts", "js", "mjs", "cjs", "mts", "cts"].flatMap((extension) => [
  `prisma.config.${extension}`,
  `.config/prisma.${extension}`,
]);

const ROOT_MARKERS: RootRules = {
  typescript: ["tsconfig.json", "jsconfig.json", "package.json"],
  python: ["pyproject.toml", "pyrightconfig.json", "setup.cfg", "setup.py", "requirements.txt"],
  prisma: [...PRISMA_CONFIGS, "prisma/schema.prisma", "schema.prisma", "package.json"],
  rust: ["Cargo.toml"],
  go: ["go.mod", "go.work"],
  java: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
  php: ["composer.json", ".phpactor.json", ".phpactor.yml"],
  lua: [".luarc.json", ".luarc.jsonc"],
  yaml: [".github", ".yamllint", "package.json"],
  actions: [".github"],
};

export async function projectRoot(
  root: string,
  start: string,
  provider: string,
  markers?: readonly string[]
) {
  if (provider === "prisma" && markers === undefined) {
    const config = await nearest(root, ancestors(root, start), PRISMA_CONFIGS);

    if (config !== null) return config.directory;
  }

  return (
    (
      await nearest(
        root,
        ancestors(root, start),
        markers ?? ROOT_MARKERS[provider] ?? ["package.json"]
      )
    )?.directory ?? root
  );
}

const PrismaPackage = Schema.Struct({
  prisma: Schema.optionalKey(Schema.Struct({ schema: Schema.optionalKey(Schema.String) })),
});

export async function prismaFacts(root: string, project: string) {
  const config = await nearest(root, [project], PRISMA_CONFIGS);

  const manifest = await existing(root, join(project, "package.json"));

  const declared =
    manifest === null
      ? undefined
      : Schema.decodeUnknownSync(PrismaPackage)(await readJson(manifest)).prisma?.schema;

  const schema =
    declared === undefined
      ? ((await nearest(root, [project], ["prisma/schema.prisma", "schema.prisma"]))?.path ?? null)
      : await existing(root, join(project, declared));

  return { config: config?.path ?? null, schema, configurationDeferred: config !== null };
}

export async function workspaceFacts(root: string, project: string, provider: string) {
  const directories = ancestors(root, project);

  if (provider === "go")
    return { workspace: (await nearest(root, directories, ["go.work"]))?.path ?? null };

  if (provider === "rust") return { manifest: await existing(root, join(project, "Cargo.toml")) };

  return {};
}

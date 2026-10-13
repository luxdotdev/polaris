import { dirname, join, resolve } from "node:path";
import { Option, Schema } from "effect";
import { existing, readText } from "../discovery/files.ts";
import { within } from "../trust/checkout.ts";

const Edition = Schema.Literals(["2015", "2018", "2021", "2024"]);

const Target = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  "proc-macro": Schema.optionalKey(Schema.Boolean),
});

const Dependency = Schema.Union([
  Schema.String,
  Schema.Struct({
    path: Schema.optionalKey(Schema.String),
    package: Schema.optionalKey(Schema.String),
  }),
]);

const PathDependency = Schema.Struct({ path: Schema.String });

/** A dependency's path inside the checkout, for `{ path = "…" }` entries only. */
const pathOf = (directory: string, spec: typeof Dependency.Type) =>
  Schema.is(PathDependency)(spec) ? resolve(directory, spec.path) : null;

const Inherited = Schema.Struct({ workspace: Schema.Literal(true) });

const DeclaredEdition = Schema.Union([Edition, Inherited, Schema.String]);

const Manifest = Schema.Struct({
  package: Schema.optionalKey(
    Schema.Struct({
      name: Schema.String,
      edition: Schema.optionalKey(DeclaredEdition),
      autobins: Schema.optionalKey(Schema.Boolean),
    })
  ),
  lib: Schema.optionalKey(Target),
  bin: Schema.optionalKey(Schema.Array(Target)),
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Dependency)),
  workspace: Schema.optionalKey(
    Schema.Struct({
      members: Schema.optionalKey(Schema.Array(Schema.String)),
      package: Schema.optionalKey(Schema.Struct({ edition: Schema.optionalKey(DeclaredEdition) })),
    })
  ),
});

type Manifest = typeof Manifest.Type;

/** One crate of a rust-project.json, as rust-analyzer reads it. */
export type RustCrate = {
  readonly display_name: string;
  readonly root_module: string;
  readonly edition: typeof Edition.Type;
  readonly deps: ReadonlyArray<{ readonly crate: number; readonly name: string }>;
  readonly is_workspace_member: boolean;
  readonly is_proc_macro: boolean;
  readonly cfg: readonly string[];
};

const MAX_MANIFESTS = 32;

async function manifest(root: string, directory: string): Promise<Manifest | null> {
  const path = await existing(root, join(directory, "Cargo.toml"));

  if (path === null) return null;

  return Option.getOrNull(
    Schema.decodeUnknownOption(Manifest)(Bun.TOML.parse(await readText(path)))
  );
}

/** Cargo's own default is 2015; inherited editions come from the nearest `[workspace]`. */
async function edition(
  root: string,
  directory: string,
  declared: typeof DeclaredEdition.Type | undefined
) {
  if (Schema.is(Edition)(declared)) return declared;

  if (declared === undefined) return "2015";

  if (!Schema.is(Inherited)(declared)) return "2021";

  for (let path = dirname(directory); within(root, path); path = dirname(path)) {
    const inherited = (await manifest(root, path))?.workspace?.package?.edition;

    if (Schema.is(Edition)(inherited)) return inherited;

    if (path === root) break;
  }

  return "2021";
}

const libraryName = (name: string) => name.replaceAll("-", "_");

async function binaries(root: string, directory: string, parsed: Manifest) {
  const name = parsed.package?.name ?? "";
  const found = new Map<string, string>();

  for (const bin of parsed.bin ?? [])
    if (bin.path !== undefined) found.set(resolve(directory, bin.path), bin.name ?? name);
    else if (bin.name !== undefined)
      for (const candidate of [`src/bin/${bin.name}.rs`, `src/bin/${bin.name}/main.rs`])
        if ((await existing(root, join(directory, candidate))) !== null)
          found.set(join(directory, candidate), bin.name);

  if (parsed.package?.autobins === false) return found;
  const main = await existing(root, join(directory, "src/main.rs"));

  if (main !== null && ![...found.keys()].includes(main)) found.set(main, name);

  return found;
}

interface Package {
  readonly directory: string;
  readonly parsed: Manifest & { readonly package: NonNullable<Manifest["package"]> };
  readonly library: string | null;
}

/** Workspace members (no globs) and path dependencies: the manifests to read next. */
const linked = (directory: string, parsed: Manifest) => [
  ...(parsed.workspace?.members ?? [])
    .filter((member) => !member.includes("*"))
    .map((member) => resolve(directory, member)),
  ...Object.values(parsed.dependencies ?? {}).flatMap((spec) => pathOf(directory, spec) ?? []),
];

async function packages(root: string, projectRoot: string) {
  const found: Package[] = [];
  const pending = [projectRoot];
  const visited = new Set<string>();

  while (pending.length > 0 && visited.size < MAX_MANIFESTS) {
    const directory = pending.shift()!;

    if (visited.has(directory) || !within(root, directory)) continue;
    visited.add(directory);
    const parsed = await manifest(root, directory);

    if (parsed === null) continue;

    pending.push(...linked(directory, parsed));

    if (parsed.package !== undefined)
      found.push({
        directory,
        parsed: { ...parsed, package: parsed.package },
        library: await existing(root, resolve(directory, parsed.lib?.path ?? "src/lib.rs")),
      });
  }

  return found;
}

const crateName = (item: Package) => libraryName(item.parsed.lib?.name ?? item.parsed.package.name);

/**
 * The crates rust-analyzer analyses before Trust, read from Cargo.toml without running cargo:
 * the package's library and binaries, and the libraries of path dependencies inside the checkout.
 */
export async function rustCrates(root: string, projectRoot: string): Promise<RustCrate[]> {
  const found = await packages(root, projectRoot);
  const libraries = new Map<string, number>();
  let next = 0;

  for (const item of found) if (item.library !== null) libraries.set(item.directory, next++);
  const libraryCrates: RustCrate[] = [];
  const binaryCrates: RustCrate[] = [];

  for (const item of found) {
    const deps = Object.entries(item.parsed.dependencies ?? {}).flatMap(([name, spec]) => {
      const path = pathOf(item.directory, spec);
      const index = path === null ? undefined : libraries.get(path);

      return index === undefined ? [] : [{ crate: index, name: libraryName(name) }];
    });

    const common = {
      edition: await edition(root, item.directory, item.parsed.package.edition),
      is_workspace_member:
        within(projectRoot, item.directory) || within(item.directory, projectRoot),
      cfg: [],
    };

    const own = libraries.get(item.directory);

    if (item.library !== null)
      libraryCrates.push({
        ...common,
        display_name: crateName(item),
        root_module: item.library,
        deps,
        is_proc_macro: item.parsed.lib?.["proc-macro"] === true,
      });

    for (const [path, name] of await binaries(root, item.directory, item.parsed))
      binaryCrates.push({
        ...common,
        display_name: libraryName(name),
        root_module: path,
        deps: own === undefined ? deps : [...deps, { crate: own, name: crateName(item) }],
        is_proc_macro: false,
      });
  }

  return [...libraryCrates, ...binaryCrates];
}

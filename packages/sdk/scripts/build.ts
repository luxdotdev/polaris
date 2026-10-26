/**
 * Builds the publishable package into `dist/`: the Node and browser bundles
 * with `@polaris/protocol` inside them, declarations for both, and a manifest
 * whose only dependency is `effect`, named `@doellsoftware/polaris-sdk` (the
 * `@polaris` npm scope isn't ours). `--pack` then runs `npm pack` on it.
 *
 *   bun run --cwd packages/sdk build [--pack]
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Schema } from "effect";

const SDK = resolve(import.meta.dir, "..");

const REPO = resolve(SDK, "..", "..");

const DIST = join(SDK, "dist");

const PUBLISHED_NAME = "@doellsoftware/polaris-sdk";

const STAGE = join(SDK, "build", "stage");

const Manifest = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  description: Schema.String,
  license: Schema.String,
  dependencies: Schema.Record(Schema.String, Schema.String),
});

const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(
  readFileSync(join(SDK, "package.json"), "utf8")
);

const run = (argv: ReadonlyArray<string>, cwd: string) => {
  const result = Bun.spawnSync([...argv], { cwd, stdout: "pipe", stderr: "pipe" });

  if (result.exitCode !== 0)
    throw new Error(
      `${argv.join(" ")} failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`
    );

  return result.stdout.toString();
};

const bundle = async (entry: string, target: "node" | "browser", name: string) => {
  const result = await Bun.build({
    entrypoints: [join(SDK, "src", entry)],
    target,
    format: "esm",
    outdir: DIST,
    naming: name,
    external: ["effect", "effect/*"],
  });

  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
};

const isSource = (file: string) =>
  file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".testing.ts");

const sourcesIn = (dir: string): Array<string> =>
  readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(isSource);

/** Copies a package's sources into the stage, pointing workspace imports at their staged copies. */
const stage = (from: string, files: ReadonlyArray<string>, to: string) => {
  for (const file of files) {
    const target = join(STAGE, to, file);

    const toStaged = (path: string) => {
      const specifier = relative(dirname(target), join(STAGE, path));

      return specifier.startsWith(".") ? specifier : `./${specifier}`;
    };

    const source = readFileSync(join(from, file), "utf8")
      .replaceAll('"@polaris/protocol"', `"${toStaged("protocol/index.ts")}"`)
      .replaceAll('"@polaris/client/rpc"', `"${toStaged("client/rpc.ts")}"`);

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
};

/** `file(line,col): error TS7056`: a declaration too large for TypeScript to write out. */
const TOO_LARGE = /^(.+?)\((\d+),\d+\): error TS7056/;

/**
 * The internal RPC groups (`DaemonRpcs`, the language RPCs) are too large to
 * declare; their staged copies are typed `any`. Nothing public names them.
 */
const eraseDeclaration = (file: string, line: number) => {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  const text = lines[line - 1] ?? "";
  const asConst = /^export const (\w+) =/.exec(text);
  const asClass = /^export class (\w+) extends /.exec(text);

  if (asConst !== null)
    lines[line - 1] = text.replace(/^export const (\w+) =/, "export const $1: any =");
  else if (asClass !== null) {
    const start =
      lines.slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0) + asClass[0].length;

    const end = source.indexOf(" {}", start);

    if (end < 0) throw new Error(`${file}:${line}: no class body after ${asClass[1]}`);
    writeFileSync(
      file,
      `${source.slice(0, start)}(${source.slice(start, end)} as any)${source.slice(end)}`
    );

    return;
  } else throw new Error(`${file}:${line}: can't erase \`${text}\``);
  writeFileSync(file, lines.join("\n"));
};

const emitDeclarations = () => {
  for (let pass = 0; pass < 10; pass++) {
    rmSync(join(DIST, "types"), { recursive: true, force: true });

    const result = Bun.spawnSync(
      [
        "bun",
        join(REPO, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        STAGE,
        "--pretty",
        "false",
      ],
      { cwd: SDK, stdout: "pipe", stderr: "pipe" }
    );

    if (result.exitCode === 0) return;
    const diagnostics = result.stdout.toString().trim().split("\n");
    const tooLarge = diagnostics.map((d) => TOO_LARGE.exec(d));

    if (tooLarge.some((match) => match === null))
      throw new Error(`declarations failed:\n${diagnostics.join("\n")}`);

    // Later lines first, so earlier edits don't move them; tsc may report one line twice.
    const erased = new Set<string>();

    for (const match of tooLarge.toSorted((a, b) => Number(b?.[2]) - Number(a?.[2]))) {
      if (match === null || erased.has(`${match[1]}:${match[2]}`)) continue;
      erased.add(`${match[1]}:${match[2]}`);
      eraseDeclaration(join(SDK, match[1] ?? ""), Number(match[2]));
    }
  }

  throw new Error("declarations still too large after 10 passes");
};

const declarations = () => {
  stage(join(SDK, "src"), sourcesIn(join(SDK, "src")), "sdk");
  stage(
    join(REPO, "packages", "protocol", "src"),
    sourcesIn(join(REPO, "packages", "protocol", "src")),
    "protocol"
  );
  stage(join(REPO, "packages", "client", "src"), ["rpc.ts"], "client");
  writeFileSync(
    join(STAGE, "tsconfig.json"),
    JSON.stringify({
      extends: relative(STAGE, join(REPO, "tsconfig.base.json")),
      compilerOptions: {
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        rewriteRelativeImportExtensions: true,
        rootDir: ".",
        outDir: relative(STAGE, join(DIST, "types")),
        // src/ is typechecked on its own; the staged copy only emits.
        noCheck: true,
      },
      files: ["sdk/index.ts", "sdk/browser.ts"],
    })
  );
  emitDeclarations();

  // Declarations keep the sources' `.ts` specifiers; the published files are `.d.ts`.
  for (const file of readdirSync(join(DIST, "types"), { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".d.ts")) continue;
    const path = join(DIST, "types", file);

    writeFileSync(
      path,
      readFileSync(path, "utf8").replaceAll(/(from |import\()"(\.{1,2}\/[^"]+)\.ts"/g, '$1"$2.js"')
    );
  }
};

const writeManifest = () => {
  const published = {
    name: PUBLISHED_NAME,
    version: manifest.version,
    description: manifest.description,
    license: manifest.license,
    // npm's provenance check requires this to name the repository the workflow ran in.
    repository: {
      type: "git",
      url: "git+https://github.com/luxdotdev/polaris.git",
      directory: "packages/sdk",
    },
    type: "module",
    exports: {
      ".": {
        browser: { types: "./types/sdk/browser.d.ts", default: "./browser.js" },
        default: { types: "./types/sdk/index.d.ts", default: "./index.js" },
      },
    },
    main: "./index.js",
    types: "./types/sdk/index.d.ts",
    engines: { node: ">=22" },
    dependencies: manifest.dependencies,
  };

  writeFileSync(join(DIST, "package.json"), `${JSON.stringify(published, null, 2)}\n`);
  cpSync(join(SDK, "README.md"), join(DIST, "README.md"));
  cpSync(join(REPO, "LICENSE"), join(DIST, "LICENSE"));
};

rmSync(DIST, { recursive: true, force: true });

rmSync(join(SDK, "build"), { recursive: true, force: true });

await bundle("index.ts", "node", "index.js");

await bundle("browser.ts", "browser", "browser.js");

declarations();

writeManifest();

if (process.argv.includes("--pack")) {
  const out = join(SDK, "build");

  mkdirSync(out, { recursive: true });
  const name = run(["npm", "pack", "--pack-destination", out], DIST).trim().split("\n").at(-1);

  console.log(join(out, name ?? ""));
} else {
  console.log(DIST);
}

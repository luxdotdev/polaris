/**
 * ast-grep's Node binding (`@ast-grep/napi`, MIT) and the tree-sitter
 * grammars it loads at run time (`@ast-grep/lang-*`, ISC).
 *
 * `bun build --compile` embeds both, like fff's library: the addon through a
 * literal `require` of the platform's `.node` file, the grammars through
 * `type: "file"` imports. Native code can't open a file inside the binary,
 * so the grammars are copied to `~/.polaris/lib/grammars/` on first use.
 * Linux builds pick glibc or musl with `--define process.env.POLARIS_LIBC='"musl"'`.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import type * as Napi from "@ast-grep/napi";
import { paths } from "../../paths.ts";
import type { PackLanguage } from "./pack.ts";

export type AstGrep = typeof Napi;

const onMusl = (): boolean => {
  // Compiled builds have it defined (`scripts/build-daemon.ts`); from source, look for musl's loader.
  const libc = process.env.POLARIS_LIBC;

  if (libc === "musl" || libc === "gnu") return libc === "musl";

  try {
    return readdirSync("/lib").some((name) => name.startsWith("ld-musl-"));
  } catch {
    return false;
  }
};

/* oxlint-disable typescript/no-require-imports -- Bun loads and embeds an N-API addon only through require */
/** The platform's addon (`import` can't load one in Bun). */
const requireAddon = (): AstGrep => {
  let addon: unknown;

  if (process.platform === "darwin" && process.arch === "arm64") {
    addon = require("@ast-grep/napi-darwin-arm64/ast-grep-napi.darwin-arm64.node");
  } else if (process.platform === "linux" && process.arch === "x64") {
    addon = onMusl()
      ? require("@ast-grep/napi-linux-x64-musl/ast-grep-napi.linux-x64-musl.node")
      : require("@ast-grep/napi-linux-x64-gnu/ast-grep-napi.linux-x64-gnu.node");
  } else if (process.platform === "linux" && process.arch === "arm64") {
    addon = onMusl()
      ? require("@ast-grep/napi-linux-arm64-musl/ast-grep-napi.linux-arm64-musl.node")
      : require("@ast-grep/napi-linux-arm64-gnu/ast-grep-napi.linux-arm64-gnu.node");
  } else {
    addon = require("@ast-grep/napi");
  }

  // SAFETY: every branch loads an @ast-grep/napi 0.45.3 build, whose exports are that package's types.
  return addon as AstGrep;
};
/* oxlint-enable typescript/no-require-imports */

/** The pack languages napi doesn't build in. */
const DYNAMIC = ["python", "go", "rust", "bash"] as const satisfies ReadonlyArray<PackLanguage>;

type GrammarFiles = Readonly<Record<(typeof DYNAMIC)[number], string>>;

const fileImport = async (promise: Promise<{ default: string }>) => (await promise).default;

const grammarFiles = async (): Promise<GrammarFiles | null> => {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return {
      python: await fileImport(
        import("@ast-grep/lang-python/prebuilds/prebuild-macOS-ARM64/parser.so", {
          with: { type: "file" },
        })
      ),
      go: await fileImport(
        import("@ast-grep/lang-go/prebuilds/prebuild-macOS-ARM64/parser.so", {
          with: { type: "file" },
        })
      ),
      rust: await fileImport(
        import("@ast-grep/lang-rust/prebuilds/prebuild-macOS-ARM64/parser.so", {
          with: { type: "file" },
        })
      ),
      bash: await fileImport(
        import("@ast-grep/lang-bash/prebuilds/prebuild-macOS-ARM64/parser.so", {
          with: { type: "file" },
        })
      ),
    };
  }

  // One glibc build per arch: musl's loader resolves its `libc.so.6` to itself (rules-layer.md §2).
  if (process.platform === "linux" && process.arch === "x64") {
    return {
      python: await fileImport(
        import("@ast-grep/lang-python/prebuilds/prebuild-Linux-X64/parser.so", {
          with: { type: "file" },
        })
      ),
      go: await fileImport(
        import("@ast-grep/lang-go/prebuilds/prebuild-Linux-X64/parser.so", {
          with: { type: "file" },
        })
      ),
      rust: await fileImport(
        import("@ast-grep/lang-rust/prebuilds/prebuild-Linux-X64/parser.so", {
          with: { type: "file" },
        })
      ),
      bash: await fileImport(
        import("@ast-grep/lang-bash/prebuilds/prebuild-Linux-X64/parser.so", {
          with: { type: "file" },
        })
      ),
    };
  }

  if (process.platform === "linux" && process.arch === "arm64") {
    return {
      python: await fileImport(
        import("@ast-grep/lang-python/prebuilds/prebuild-Linux-ARM64/parser.so", {
          with: { type: "file" },
        })
      ),
      go: await fileImport(
        import("@ast-grep/lang-go/prebuilds/prebuild-Linux-ARM64/parser.so", {
          with: { type: "file" },
        })
      ),
      rust: await fileImport(
        import("@ast-grep/lang-rust/prebuilds/prebuild-Linux-ARM64/parser.so", {
          with: { type: "file" },
        })
      ),
      bash: await fileImport(
        import("@ast-grep/lang-bash/prebuilds/prebuild-Linux-ARM64/parser.so", {
          with: { type: "file" },
        })
      ),
    };
  }

  return null;
};

/** The registrations from each `@ast-grep/lang-*` package's index.js. */
const REGISTRATION = {
  python: { extensions: ["py"], languageSymbol: "tree_sitter_python", expandoChar: "µ" },
  go: { extensions: ["go"], languageSymbol: "tree_sitter_go", expandoChar: "µ" },
  rust: { extensions: ["rs"], languageSymbol: "tree_sitter_rust", expandoChar: "µ" },
  bash: { extensions: ["sh", "bash"], languageSymbol: "tree_sitter_bash", expandoChar: "$" },
} as const;

/**
 * A path native code can open: the file itself from source, or a copy under
 * `~/.polaris/lib/grammars/` named by its embedded name (which carries a content hash).
 */
const onDisk = (path: string, language: string): string => {
  if (!path.startsWith("/$bunfs/")) return path;
  const dir = join(paths().root, "lib", "grammars");
  const target = join(dir, `${language}-${basename(path)}`);

  if (existsSync(target)) return target;
  mkdirSync(dir, { recursive: true });
  const temp = `${target}.tmp-${process.pid}`;
  copyFileSync(path, temp);
  renameSync(temp, target);

  return target;
};

let loaded: Promise<AstGrep> | null = null;

/** The addon with every pack language registered; loaded once per process. */
export const loadAstGrep = (): Promise<AstGrep> =>
  (loaded ??= (async () => {
    const napi = requireAddon();
    const files = await grammarFiles();

    if (files !== null) {
      napi.registerDynamicLanguage(
        Object.fromEntries(
          DYNAMIC.map((language) => [
            language,
            {
              ...REGISTRATION[language],
              extensions: [...REGISTRATION[language].extensions],
              libraryPath: onDisk(files[language], language),
            },
          ])
        )
      );
    }

    return napi;
  })());

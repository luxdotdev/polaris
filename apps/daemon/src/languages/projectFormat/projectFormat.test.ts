import { chmod, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  LanguageCheckout,
  LanguageProjectFormatInput,
  LanguageProjectFormatOutcome,
  type LanguageProjectFormatterTool,
  WorkspaceId,
} from "@polaris/protocol";
import { Effect } from "effect";
import { fixture } from "../discovery/fixture.ts";
import { canonicalCheckout, createExecutionTrust, ExecutionTrustService } from "../trust/index.ts";
import { createFileTrustRepository } from "../trust/repository.ts";
import {
  detectProjectFormatter,
  formatterPath,
  formatWithProject,
  ignoreMatcher,
  type PrivateNode,
} from "./index.ts";
import { nativePackages } from "./launch.ts";
import { posixTest } from "../../platform/testing.ts";

const posixTools = posixTest(
  "the fake formatters and private Node are POSIX sh scripts and bin/ names; Windows resolves .cmd/.exe (ENG-296)"
);

type Fixture = Awaited<ReturnType<typeof fixture>>;

const Outcome = LanguageProjectFormatOutcome.cases;

const formatted = (text: string, tool: LanguageProjectFormatterTool = "prettier", version = 7) =>
  Outcome.Formatted.make({ requestId: "r1", version, tool, text });

const skipped = (reason: "ignored" | "no-formatter") =>
  Outcome.Skipped.make({ requestId: "r1", version: 7, reason });

const failed = (
  reason: "not-installed" | "timeout" | "cancelled" | "formatter-failed",
  message: string
) => Outcome.Failed.make({ requestId: "r1", reason, message });

const withFixture = async (body: (f: Fixture) => Promise<void>) => {
  const f = await fixture();

  try {
    await body(f);
  } finally {
    await f.cleanup();
  }
};

/** The fake formatters below are shell shims that never call `node`; any private Node will do. */
const shimNode: PrivateNode = async () => "/polaris-private/node/bin/node";

/** A stand-in formatter: upper-cases stdin and records its arguments and directory. */
const fakeBinary = async (f: Fixture, path: string, script = "tr a-z A-Z") => {
  const full = await f.put(
    path,
    `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > "$(dirname "$0")/../../args.txt"\n${script}\n`
  );

  await chmod(full, 0o755);

  return full;
};

const input = (f: Fixture, path: string, text: string, version = 7) =>
  LanguageProjectFormatInput.make({
    checkout: f.checkout,
    path,
    requestId: "r1",
    version,
    text,
    deadline: Date.now() + 5000,
  });

describe("detection", () => {
  test.each([
    ["oxfmt", "oxfmt.config.mts"],
    ["oxfmt", ".oxfmtrc.json"],
    ["oxfmt", "oxfmt.json"],
    ["prettier", ".prettierrc"],
    ["prettier", "prettier.config.mjs"],
    ["biome", "biome.json"],
    ["biome", "biome.jsonc"],
    ["dprint", "dprint.json"],
  ] as const)("%s from %s", (tool, config) =>
    withFixture(async (f) => {
      await f.put(config, "{}");
      const file = await f.put("src/a.ts");

      expect(await detectProjectFormatter(f.root, file)).toEqual({
        tool,
        root: f.root,
        config: join(f.root, config),
        installed: false,
        ignored: false,
      });
    })
  );

  test("package.json's prettier key is a config; a dependency is the fallback", () =>
    withFixture(async (f) => {
      await f.put("package.json", JSON.stringify({ prettier: { semi: false } }));
      const file = await f.put("a.ts");

      expect((await detectProjectFormatter(f.root, file))?.config).toBe(
        join(f.root, "package.json")
      );

      await f.put("package.json", JSON.stringify({ devDependencies: { "@biomejs/biome": "2" } }));
      expect(await detectProjectFormatter(f.root, file)).toMatchObject({
        tool: "biome",
        config: null,
      });

      await f.put("package.json", JSON.stringify({ dependencies: { react: "19" } }));
      expect(await detectProjectFormatter(f.root, file)).toBeNull();
    }));

  test("the nearest config wins over a farther config or dependency", () =>
    withFixture(async (f) => {
      await f.put("oxfmt.config.mts", "export default {}");
      await f.put(
        "packages/web/package.json",
        JSON.stringify({ devDependencies: { prettier: "3" } })
      );
      await f.put("packages/docs/.prettierrc", "{}");
      const web = await f.put("packages/web/src/a.ts");
      const docs = await f.put("packages/docs/src/a.ts");

      expect(await detectProjectFormatter(f.root, web)).toMatchObject({
        tool: "oxfmt",
        root: f.root,
      });
      expect(await detectProjectFormatter(f.root, docs)).toMatchObject({
        tool: "prettier",
        root: join(f.root, "packages/docs"),
      });
    }));

  test("never looks above the checkout", () =>
    withFixture(async (f) => {
      await f.put("../.prettierrc", "{}");
      const file = await f.put("a.ts");

      expect(await detectProjectFormatter(f.root, file)).toBeNull();
    }));

  test("the binary is found in a hoisted node_modules/.bin", () =>
    withFixture(async (f) => {
      await f.put("packages/web/.prettierrc", "{}");
      await fakeBinary(f, "node_modules/.bin/prettier");
      const file = await f.put("packages/web/a.ts");

      expect((await detectProjectFormatter(f.root, file))?.installed).toBe(true);
    }));

  test("ignore files and node_modules exclude a file", () =>
    withFixture(async (f) => {
      await f.put(".prettierrc", "{}");
      await f.put(".prettierignore", "# generated\ngenerated/\n*.min.js\n!keep.min.js\n");

      const ignored = async (path: string) =>
        (await detectProjectFormatter(f.root, await f.put(path)))?.ignored;

      expect(await ignored("src/a.ts")).toBe(false);
      expect(await ignored("generated/a.ts")).toBe(true);
      expect(await ignored("src/vendor.min.js")).toBe(true);
      expect(await ignored("src/keep.min.js")).toBe(false);
      expect(await ignored("node_modules/x/a.ts")).toBe(true);
    }));
});

describe("Rust and Lua", () => {
  test("the JS formatters never take a Rust or Lua file; StyLua takes only Lua", () =>
    withFixture(async (f) => {
      await f.put(".prettierrc", "{}");
      await f.put("package.json", JSON.stringify({ devDependencies: { prettier: "3" } }));
      const rust = await f.put("src/main.rs");
      const lua = await f.put("scripts/init.lua");
      const ts = await f.put("src/a.ts");

      expect(await detectProjectFormatter(f.root, rust)).toBeNull();
      expect(await detectProjectFormatter(f.root, lua)).toBeNull();

      await f.put("stylua.toml", "indent_type = 'Spaces'");
      expect(await detectProjectFormatter(f.root, lua)).toMatchObject({
        tool: "stylua",
        root: f.root,
        config: join(f.root, "stylua.toml"),
      });
      expect(await detectProjectFormatter(f.root, rust)).toBeNull();
      expect(await detectProjectFormatter(f.root, ts)).toMatchObject({ tool: "prettier" });
    }));

  posixTools("StyLua gets the buffer on stdin with the file's path", () =>
    withFixture(async (f) => {
      await f.put(".stylua.toml", "");
      await fakeBinary(f, "node_modules/.bin/stylua");

      expect(
        await formatWithProject(
          await canonicalCheckout(f.registry, f.checkout),
          input(f, join(f.root, "a.lua"), "local x = 1\n"),
          new AbortController().signal,
          shimNode
        )
      ).toEqual(formatted("LOCAL X = 1\n", "stylua"));
      expect(await Bun.file(join(f.root, "args.txt")).text()).toBe(
        `${f.root}\n--stdin-filepath\n${join(f.root, "a.lua")}\n-\n`
      );
    })
  );
});

describe("ignore matcher", () => {
  test("gitignore semantics: anchoring, directories, negation", () => {
    const ignored = ignoreMatcher("/build\ndist/\n**/*.snap\nfoo/bar.ts\n!dist/keep.ts\n");

    expect(ignored("build/a.ts")).toBe(true);
    expect(ignored("src/build/a.ts")).toBe(false);
    expect(ignored("pkg/dist/a.ts")).toBe(true);
    expect(ignored("dist")).toBe(false);
    expect(ignored("a/b.snap")).toBe(true);
    expect(ignored("foo/bar.ts")).toBe(true);
    expect(ignored("x/foo/bar.ts")).toBe(false);
    expect(ignored("dist/keep.ts")).toBe(false);
  });
});

describe("formatting", () => {
  const format = async (f: Fixture, path: string, text: string, version = 7) =>
    formatWithProject(
      await canonicalCheckout(f.registry, f.checkout),
      input(f, path, text, version),
      new AbortController().signal,
      shimNode
    );

  posixTools("runs the checkout's binary on the buffer text from the config's directory", () =>
    withFixture(async (f) => {
      await f.put("packages/web/.prettierrc", "{}");
      await fakeBinary(f, "node_modules/.bin/prettier");
      const file = await f.put("packages/web/src/a.ts", "on disk");

      expect(await format(f, file, "buffer text\n", 41)).toEqual(
        formatted("BUFFER TEXT\n", "prettier", 41)
      );
      expect(await Bun.file(join(f.root, "args.txt")).text()).toBe(
        `${join(f.root, "packages/web")}\n--stdin-filepath\n${file}\n`
      );
    })
  );

  posixTools("a file that doesn't exist yet formats by its directory", () =>
    withFixture(async (f) => {
      await f.put(".prettierrc", "{}");
      await fakeBinary(f, "node_modules/.bin/prettier");
      await f.put("src/existing.ts");

      expect(await format(f, join(f.root, "src/new.ts"), "x")).toEqual(formatted("X"));
    })
  );

  posixTools("ignored, missing and failing formatters never change text", () =>
    withFixture(async (f) => {
      await f.put(".prettierrc", "{}");
      await f.put(".prettierignore", "generated/\n");
      const generated = await f.put("generated/a.ts");
      const file = await f.put("src/a.ts");

      expect(await format(f, generated, "x")).toEqual(skipped("ignored"));
      expect(await format(f, file, "x")).toEqual(
        failed("not-installed", "prettier isn't installed in this checkout's node_modules")
      );

      await fakeBinary(f, "node_modules/.bin/prettier", "echo 'SyntaxError: nope' >&2; exit 2");
      expect(await format(f, file, "x")).toEqual(failed("formatter-failed", "SyntaxError: nope"));
    })
  );

  posixTools("a slow formatter times out", () =>
    withFixture(async (f) => {
      await f.put(".prettierrc", "{}");
      await fakeBinary(f, "node_modules/.bin/prettier", "sleep 5");
      const file = await f.put("a.ts");
      const canonical = await canonicalCheckout(f.registry, f.checkout);

      const outcome = await formatWithProject(
        canonical,
        { ...input(f, file, "x"), deadline: Date.now() + 100 },
        new AbortController().signal,
        shimNode
      );

      expect(outcome).toEqual(failed("timeout", "prettier timed out"));
    })
  );

  test("with no formatter the outcome says so", () =>
    withFixture(async (f) => {
      const file = await f.put("a.ts");

      expect(await format(f, file, "x")).toEqual(skipped("no-formatter"));
    }));
});

describe("Trust", () => {
  posixTools("the formatter runs only inside a trusted checkout", () =>
    withFixture(async (f) => {
      await f.put(".prettierrc", "{}");
      await fakeBinary(f, "node_modules/.bin/prettier");
      const file = await f.put("a.ts");

      const options = {
        hostId: f.hostId,
        registry: f.registry,
        repository: createFileTrustRepository(join(f.temporary, "trust")),
        authorizeGrant: async () => {},
      };

      const run = Effect.gen(function* () {
        const trust = yield* ExecutionTrustService;

        return yield* trust.execute(f.checkout, (canonical, signal) =>
          formatWithProject(canonical, input(f, file, "x"), signal, shimNode)
        );
      }).pipe(Effect.provide(ExecutionTrustService.layer(options)));

      const refused = await Effect.runPromise(Effect.flip(run));

      expect(refused.reason).toBe("awaiting-trust");
      expect(await Bun.file(join(f.root, "args.txt")).exists()).toBe(false);

      await createExecutionTrust(options).set(f.checkout, true, 0);
      expect(await Effect.runPromise(run)).toEqual(formatted("X"));
    })
  );
});

describe("this repository", () => {
  const root = join(import.meta.dir, "../../../../..");

  const realNode = Bun.which("node");

  (realNode === null ? test.skip : posixTools)(
    "formats with its own oxfmt and config on the private Node, with an empty PATH",
    async () => {
      const checkout = LanguageCheckout.cases.Workspace.make({
        workspaceId: WorkspaceId.make("repo"),
        path: root,
      });

      const file = join(root, "apps/daemon/src/main.ts");
      const found = await detectProjectFormatter(root, file);

      expect(found).toMatchObject({ tool: "oxfmt", root, installed: true, ignored: false });

      const outcome = await withPath("", () =>
        formatWithProject(
          { checkout, root, workspaceRoot: root },
          LanguageProjectFormatInput.make({
            checkout,
            path: file,
            requestId: "r1",
            version: 1,
            text: "export { };\nconst a = {b:1}\n",
            deadline: Date.now() + 10_000,
          }),
          new AbortController().signal,
          async () => realNode
        )
      );

      expect(outcome).toEqual(formatted("export {};\nconst a = { b: 1 };\n", "oxfmt", 1));
    }
  );
});

/** Runs with the Daemon's PATH replaced, as on a Host whose PATH has no Node (or another one). */
async function withPath<A>(path: string, body: () => Promise<A>): Promise<A> {
  const saved = process.env.PATH;

  process.env.PATH = path;

  try {
    return await body();
  } finally {
    process.env.PATH = saved;
  }
}

describe("runtime", () => {
  /** A stand-in private Node: records how it was called, then formats like the fakes above. */
  const privateNode = async (f: Fixture) => {
    const node = await f.put(
      "../private/node/bin/node",
      `#!/bin/sh\nprintf '%s\\n' "$0" "$@" > "${f.temporary}/node-args.txt"\n/usr/bin/tr a-z A-Z\n`
    );

    await chmod(node, 0o755);

    return node;
  };

  /** The shape npm and Bun install: `.bin/<tool>` links to the package's Node entry point. */
  const nodeEntry = async (f: Fixture) => {
    const entry = await f.put(
      "node_modules/prettier/bin/prettier.cjs",
      "#!/usr/bin/env node\nrequire('../index.js');\n"
    );

    await mkdir(join(f.root, "node_modules/.bin"), { recursive: true });
    await symlink(entry, join(f.root, "node_modules/.bin/prettier"));

    return entry;
  };

  const run = async (f: Fixture, node: PrivateNode, file: string) =>
    formatWithProject(
      await canonicalCheckout(f.registry, f.checkout),
      input(f, file, "x"),
      new AbortController().signal,
      node
    );

  posixTools("a Node entry point runs on the private Node, with an empty PATH", () =>
    withFixture(async (f) => {
      await f.put(".prettierrc", "{}");
      const node = await privateNode(f);
      const entry = await nodeEntry(f);
      const file = await f.put("a.ts");

      expect(await withPath("", () => run(f, async () => node, file))).toEqual(formatted("X"));
      expect(await Bun.file(join(f.temporary, "node-args.txt")).text()).toBe(
        `${node}\n${entry}\n--stdin-filepath\n${file}\n`
      );
    })
  );

  posixTools("a shell shim's `node` is the private Node, never the one on the Daemon's PATH", () =>
    withFixture(async (f) => {
      await f.put(".prettierrc", "{}");
      const node = await privateNode(f);
      const shim = await f.put("node_modules/.bin/prettier", '#!/bin/sh\nexec node "$@"\n');
      const userNode = await f.put("../user/bin/node", "#!/bin/sh\nexit 99\n");
      const file = await f.put("a.ts");

      await chmod(shim, 0o755);
      await chmod(userNode, 0o755);

      for (const path of ["", join(f.temporary, "user/bin")])
        expect(await withPath(path, () => run(f, async () => node, file))).toEqual(formatted("X"));
    })
  );

  test("without the private Node, a Node tool doesn't run", () =>
    withFixture(async (f) => {
      await f.put(".prettierrc", "{}");
      await nodeEntry(f);
      const file = await f.put("a.ts");

      expect(await run(f, async () => null, file)).toEqual(
        failed("not-installed", "Polaris's private Node isn't installed on this Host yet")
      );
    }));

  posixTools("a native platform binary runs directly, without any Node", () =>
    withFixture(async (f) => {
      await f.put("biome.json", "{}");
      const [name] = nativePackages("biome");

      if (name === undefined) throw new Error("No biome platform package for this platform");
      const binary = await f.put(`node_modules/${name}`, "#!/bin/sh\n/usr/bin/tr a-z A-Z\n");
      const file = await f.put("a.ts");

      await chmod(binary, 0o755);
      expect(await withPath("", () => run(f, async () => null, file))).toEqual(
        formatted("X", "biome")
      );
    })
  );

  test("the child's PATH puts the private Node first", () => {
    expect(formatterPath("/p/node/bin/node", "/usr/bin:/bin")).toBe("/p/node/bin:/usr/bin:/bin");
    expect(formatterPath("/p/node/bin/node", "")).toBe("/p/node/bin");
    expect(formatterPath(null, "/usr/bin")).toBe("/usr/bin");
  });
});

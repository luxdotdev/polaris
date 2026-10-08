import { chmod } from "node:fs/promises";
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
import { detectProjectFormatter, formatWithProject, ignoreMatcher } from "./index.ts";

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
      new AbortController().signal
    );

  test("runs the checkout's binary on the buffer text from the config's directory", () =>
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
    }));

  test("a file that doesn't exist yet formats by its directory", () =>
    withFixture(async (f) => {
      await f.put(".prettierrc", "{}");
      await fakeBinary(f, "node_modules/.bin/prettier");
      await f.put("src/existing.ts");

      expect(await format(f, join(f.root, "src/new.ts"), "x")).toEqual(formatted("X"));
    }));

  test("ignored, missing and failing formatters never change text", () =>
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
    }));

  test("a slow formatter times out", () =>
    withFixture(async (f) => {
      await f.put(".prettierrc", "{}");
      await fakeBinary(f, "node_modules/.bin/prettier", "sleep 5");
      const file = await f.put("a.ts");
      const canonical = await canonicalCheckout(f.registry, f.checkout);

      const outcome = await formatWithProject(
        canonical,
        { ...input(f, file, "x"), deadline: Date.now() + 100 },
        new AbortController().signal
      );

      expect(outcome).toEqual(failed("timeout", "prettier timed out"));
    }));

  test("with no formatter the outcome says so", () =>
    withFixture(async (f) => {
      const file = await f.put("a.ts");

      expect(await format(f, file, "x")).toEqual(skipped("no-formatter"));
    }));
});

describe("Trust", () => {
  test("the formatter runs only inside a trusted checkout", () =>
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
          formatWithProject(canonical, input(f, file, "x"), signal)
        );
      }).pipe(Effect.provide(ExecutionTrustService.layer(options)));

      const refused = await Effect.runPromise(Effect.flip(run));

      expect(refused.reason).toBe("awaiting-trust");
      expect(await Bun.file(join(f.root, "args.txt")).exists()).toBe(false);

      await createExecutionTrust(options).set(f.checkout, true, 0);
      expect(await Effect.runPromise(run)).toEqual(formatted("X"));
    }));
});

describe("this repository", () => {
  const root = join(import.meta.dir, "../../../../..");

  test("formats with its own oxfmt and config, not the TypeScript server's style", async () => {
    const checkout = LanguageCheckout.cases.Workspace.make({
      workspaceId: WorkspaceId.make("repo"),
      path: root,
    });

    const file = join(root, "apps/daemon/src/main.ts");
    const found = await detectProjectFormatter(root, file);

    expect(found).toMatchObject({ tool: "oxfmt", root, installed: true, ignored: false });

    const outcome = await formatWithProject(
      { checkout, root, workspaceRoot: root },
      LanguageProjectFormatInput.make({
        checkout,
        path: file,
        requestId: "r1",
        version: 1,
        text: "export { };\nconst a = {b:1}\n",
        deadline: Date.now() + 10_000,
      }),
      new AbortController().signal
    );

    expect(outcome).toEqual(formatted("export {};\nconst a = { b: 1 };\n", "oxfmt", 1));
  });
});

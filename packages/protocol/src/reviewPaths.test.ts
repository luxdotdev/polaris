import { describe, expect, test } from "bun:test";
import { compilePatterns, expandBraces, isGeneratedPath, isTestPath } from "./reviewPaths.ts";

describe("review path patterns", () => {
  test("a name without a slash matches at any depth; a trailing slash matches a directory", () => {
    const match = compilePatterns(["*.snap", "fixtures/", "src/gen/*.ts"]);

    expect(match("a.snap")).toBe(true);
    expect(match("deep/er/a.snap")).toBe(true);
    expect(match("x/fixtures/a/b.json")).toBe(true);
    expect(match("x/fixtures.json")).toBe(false);
    expect(match("src/gen/a.ts")).toBe(true);
    expect(match("lib/src/gen/a.ts")).toBe(false);
  });

  test("braces alternate and a ! line rescues a path", () => {
    expect(expandBraces("a.{js,ts}")).toEqual(["a.js", "a.ts"]);

    const match = compilePatterns(["*.{js,ts}", "!keep.ts", "# a comment", ""]);

    expect(match("x/a.js")).toBe(true);
    expect(match("keep.ts")).toBe(false);
    expect(match("a.md")).toBe(false);
  });

  test("lockfiles and generator output are generated", () => {
    for (const path of ["bun.lock", "web/pnpm-lock.yaml", "api/v1/user.pb.go", "dist/index.js"]) {
      expect(isGeneratedPath(path)).toBe(true);
    }

    for (const path of ["src/index.ts", "lock.ts", "README.md"]) {
      expect(isGeneratedPath(path)).toBe(false);
    }
  });

  test("tests, snapshots and runner config are tests; an OpenAPI spec is not", () => {
    for (const path of [
      "src/a.test.ts",
      "src/engine/session.testing.ts",
      "pkg/a_test.go",
      "tests/test_api.py",
      "src/__snapshots__/a.snap",
      "vitest.config.ts",
      "FooTest.java",
    ]) {
      expect(isTestPath(path)).toBe(true);
    }

    for (const path of ["api.spec.yaml", "src/latest.ts", "packages/spec/polaris.qnt"]) {
      expect(isTestPath(path)).toBe(false);
    }
  });
});

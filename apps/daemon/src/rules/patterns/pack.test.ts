import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAstGrep } from "./native.ts";
import { appliesTo, builtinPack, languageOf, parsePack, type PackLanguage } from "./pack.ts";
import { type PatternMatch, scanSource } from "./scan.ts";

const fixtures = join(import.meta.dir, "..", "fixtures");

/** Each fixture under its real name, with the line its safe lookalikes start on. */
const loadFixtures = () =>
  readdirSync(fixtures)
    .filter((name) => name.endsWith(".fixture"))
    .map((name) => {
      const path = name.replace(/\.fixture$/, "");
      const source = readFileSync(join(fixtures, name), "utf8");
      const safeFrom = source.split("\n").findIndex((line) => /safe lookalike/i.test(line)) + 1;

      return { path, language: languageOf(path)!, source, safeFrom };
    });

const scanAll = async () => {
  const napi = await loadAstGrep();
  const rules = builtinPack();

  return loadFixtures().map((fixture) => ({
    ...fixture,
    matches: scanSource(napi, rules, fixture.path, fixture.language, fixture.source),
  }));
};

const key = (m: PatternMatch) => `${m.ruleId}@${m.path}:${m.start}`;

describe("the built-in pack", () => {
  test("has the 28 starter rules, each with a Severity and a known language", () => {
    const rules = builtinPack();
    expect(rules).toHaveLength(28);
    expect(new Set(rules.map((r) => r.id)).size).toBe(28);
    expect(rules.filter((r) => r.note === null).map((r) => r.id)).toEqual([]);
    expect(rules.filter((r) => r.severity === "critical").map((r) => r.id)).toContain(
      "sh-rm-rf-variable"
    );
  });

  test("every rule fires on its fixture, and nothing fires on a safe lookalike", async () => {
    const scanned = await scanAll();
    const fired = new Set(scanned.flatMap((f) => f.matches.map((m) => m.ruleId)));

    expect(builtinPack().filter((rule) => !fired.has(rule.id))).toEqual([]);

    for (const fixture of scanned) {
      expect(fixture.safeFrom).toBeGreaterThan(0);
      expect(fixture.matches.filter((m) => m.start > fixture.safeFrom).map(key)).toEqual([]);
    }
  });

  test("one combined walk finds exactly what one walk per rule finds", async () => {
    const napi = await loadAstGrep();

    for (const fixture of loadFixtures()) {
      const rules = builtinPack().filter((r) => r.language === fixture.language);
      const combined = scanSource(napi, rules, fixture.path, fixture.language, fixture.source);
      const lang = fixture.language === "tsx" ? napi.Lang.Tsx : fixture.language;
      const root = napi.parse(lang, fixture.source).root();

      const single = rules.flatMap((rule) =>
        root
          .findAll(rule.config)
          .map((node) => `${rule.id}@${fixture.path}:${node.range().start.line + 1}`)
      );

      expect(combined.map(key).sort()).toEqual(single.sort());
    }
  });

  test("a match nested inside another rule's candidate is still found", async () => {
    const napi = await loadAstGrep();
    const matches = scanSource(napi, builtinPack(), "a.ts", "tsx", "outer(exec(`rm ${dir}`));\n");

    expect(matches.map((m) => m.ruleId)).toEqual(["js-shell-interpolation"]);
  });
});

describe("rule scope", () => {
  const recursiveDelete = builtinPack().find((rule) => rule.id === "js-recursive-delete")!;

  test("ignores keep the recursive-delete rule out of tests and scripts", () => {
    expect(appliesTo(recursiveDelete, "src/cleanup.ts")).toBe(true);
    expect(appliesTo(recursiveDelete, "src/cleanup.test.ts")).toBe(false);
    expect(appliesTo(recursiveDelete, "test/cleanup.ts")).toBe(false);
    expect(appliesTo(recursiveDelete, "packages/x/scripts/clean.ts")).toBe(false);
  });

  test("files narrows a rule to matching paths", () => {
    const [rule] = parsePack({
      x: [
        "id: only-migrations",
        "language: tsx",
        "severity: error",
        "message: m",
        "metadata: { polaris-severity: High, category: data-loss }",
        'files: ["**/migrations/**"]',
        "rule: { kind: debugger_statement }",
      ].join("\n"),
    });

    expect(appliesTo(rule!, "db/migrations/001.ts")).toBe(true);
    expect(appliesTo(rule!, "src/app.ts")).toBe(false);
  });

  test.each([
    ["a.ts", "tsx"],
    ["a.mjs", "tsx"],
    ["a.jsx", "tsx"],
    ["a.cts", "tsx"],
    ["a.py", "python"],
    ["a.go", "go"],
    ["a.rs", "rust"],
    ["a.sh", "bash"],
    ["a.md", null],
    ["Makefile", null],
  ] as const)("%s scans as %s", (path, language: PackLanguage | null) => {
    expect(languageOf(path)).toBe(language);
  });

  test("a rule document missing its Severity is rejected", () => {
    expect(() =>
      parsePack({ x: "id: x\nlanguage: tsx\nseverity: error\nmessage: m\nrule: { kind: x }" })
    ).toThrow();
  });
});

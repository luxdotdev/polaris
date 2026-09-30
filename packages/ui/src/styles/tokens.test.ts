import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const tokens = read("./tokens.css");

const theme = read("./theme.css");

const assets = read("./assets.css");

const design = read("../../../../DESIGN.md");

/** DESIGN.md frontmatter colours, "name: #hex". */
function designColours(): Map<string, string> {
  const frontmatter = design.split("---")[1] ?? "";
  const colours = new Map<string, string>();

  for (const match of frontmatter.matchAll(/^ {2}([a-z0-9-]+): "(#[0-9A-Fa-f]{6,8})"/gm)) {
    const [, name, hex] = match;

    if (name !== undefined && hex !== undefined) colours.set(name, hex.toLowerCase());
  }

  return colours;
}

function tokenValue(name: string): string | undefined {
  const match = new RegExp(`--color-${name}:\\s*([^;]+);`).exec(tokens);

  return match?.[1]?.trim().toLowerCase();
}

describe("tokens", () => {
  const colours = designColours();

  test("reads DESIGN.md's colours", () => {
    expect(colours.size).toBeGreaterThan(40);
  });

  test("every -dark/-light pair in DESIGN.md is one light-dark() token", () => {
    let pairs = 0;

    for (const [name, dark] of colours) {
      if (!name.endsWith("-dark")) continue;

      const base = name.slice(0, -"-dark".length);
      const light = colours.get(`${base}-light`);

      if (light === undefined) continue;

      pairs += 1;
      expect(tokenValue(base)).toBe(`light-dark(${light}, ${dark})`);
    }

    expect(pairs).toBeGreaterThan(20);
  });

  test("every single-value DESIGN.md colour keeps its value in both themes", () => {
    for (const [name, value] of colours) {
      if (name.endsWith("-dark") || name.endsWith("-light")) continue;

      const token = tokenValue(name);

      expect(token === value || token?.endsWith(`, ${value})`)).toBe(true);
    }
  });

  test("clears Tailwind's palette, so only Polaris colours exist", () => {
    expect(tokens).toContain("--color-*: initial;");
    expect(tokens).toContain("@theme static");
  });
});

describe("theming", () => {
  test("dark is the default", () => {
    expect(theme).toMatch(/:root\s*\{\s*color-scheme: dark;/);
  });

  test("light follows data-theme and, unless dark is forced, the system", () => {
    expect(theme).toMatch(/\[data-theme="light"\]\s*\{\s*color-scheme: light;/);
    expect(theme).toMatch(
      /@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme="dark"\]\)\s*\{\s*color-scheme: light;/
    );
  });

  test("a themed subtree resets its inherited colours", () => {
    expect(theme).toMatch(
      /\[data-theme\]\s*\{[^}]*background-color: var\(--color-bg\);[^}]*color: var\(--color-text-default\);/
    );
  });

  test("washes and scenes switch with the same selectors", () => {
    for (const selector of [
      ':root,\n[data-theme="dark"]',
      '[data-theme="light"]',
      ':root:not([data-theme="dark"])',
    ]) {
      expect(assets).toContain(selector);
    }

    expect(assets.match(/scene-dawn/g)?.length).toBe(2);
  });

  test("focus is a 2px Starlight ring with a 2px offset", () => {
    expect(theme).toMatch(
      /:focus-visible\s*\{\s*outline: 2px solid var\(--color-starlight\);\s*outline-offset: 2px;/
    );
  });
});

describe("accessibility hooks", () => {
  test("the cvd palette remaps the diff colours, fills and emphasis", () => {
    const block = /\[data-diff-palette="cvd"\]\s*\{([^}]*)\}/.exec(theme)?.[1] ?? "";

    for (const name of ["added", "removed"]) {
      expect(block).toContain(`--color-diff-${name}: var(--color-diff-${name}-cvd);`);
      expect(block).toContain(`--color-diff-${name}-text: var(--color-diff-${name}-cvd-text);`);
      expect(block).toContain(`--color-diff-${name}-bg:`);
      expect(block).toContain(`--color-diff-${name}-emphasis:`);
    }
  });

  test("text size scales every type role, independent of density", () => {
    const block = /:root,\s*\[data-text-size\]\s*\{([^}]*)\}/.exec(theme)?.[1] ?? "";

    for (const role of [
      "display",
      "title",
      "heading",
      "heading-sm",
      "body",
      "label",
      "caption",
      "code",
      "code-inline",
      "micro",
    ]) {
      expect(block).toContain(`--text-${role}: round(calc(`);
      expect(block).toContain(`--text-${role}--line-height: round(calc(`);
    }

    expect(theme).toMatch(/\[data-text-size="large"\]\s*\{\s*--text-scale: calc\(14 \/ 13\);/);
  });
});

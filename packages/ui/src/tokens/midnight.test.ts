import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { midnight } from ".";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const tokens = read("../styles/tokens.css");

const theme = read("../styles/theme.css");

const design = read("../../../../DESIGN.md");

const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** A `color-mix(in oklab, #hex N%, transparent)` fill as 8-digit hex. */
function resolve(value: string): string | undefined {
  if (/^#[0-9a-f]{6,8}$/.test(value)) return value;

  const mix = /^color-mix\(in oklab, (#[0-9a-f]{6}) (\d+)%, transparent\)$/.exec(value);

  if (mix?.[1] === undefined || mix[2] === undefined) return undefined;

  return (
    mix[1] +
    Math.round(Number(mix[2]) * 2.55)
      .toString(16)
      .padStart(2, "0")
  );
}

/** Each --color token's dark value: the second light-dark() arm, or the single value. */
function darkColours(): Map<string, string> {
  const colours = new Map<string, string>();

  for (const [, name, raw] of tokens.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) {
    if (name === undefined || raw === undefined) continue;

    const value = raw.replace(/\s+/g, " ").trim().toLowerCase();
    const pair = /^light-dark\((.+)\)$/.exec(value)?.[1]?.split(/,(?![^(]*\))/);
    const dark = resolve((pair?.[1] ?? value).trim());

    if (dark === undefined) throw new Error(`--color-${name} has no plain dark value: ${value}`);
    colours.set(name, dark);
  }

  return colours;
}

function midnightOverrides(): Map<string, string> {
  const block = /\[data-theme="midnight"\]\s*\{([^}]*)\}/.exec(theme)?.[1] ?? "";

  return new Map(
    [...block.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name ?? "",
      (value ?? "").trim().toLowerCase(),
    ])
  );
}

describe("midnight", () => {
  test("the TS constants are dark's tokens with theme.css's midnight overrides, nothing else", () => {
    const expected: Record<string, string> = {};

    for (const [name, value] of darkColours()) expected[camel(name)] = value;

    for (const [name, value] of midnightOverrides()) expected[camel(name)] = value;

    expect(Object.keys(expected).length).toBeGreaterThan(50);
    expect<Record<string, string>>({ ...midnight }).toEqual(expected);
  });

  test("overrides exactly DESIGN.md's ground, surfaces and hairline", () => {
    const prose =
      /true black ground `(#[0-9A-F]{6})`, surfaces `(#[0-9A-F]{6})` and `(#[0-9A-F]{6})`, hairlines white at (\d+)%/.exec(
        design
      );

    expect(prose).not.toBeNull();

    const [, ground = "", sunken = "", raised = "", hairline = ""] = prose ?? [];

    const alpha = Math.round(Number(hairline) * 2.55)
      .toString(16)
      .padStart(2, "0");

    expect(Object.fromEntries(midnightOverrides())).toEqual({
      bg: ground.toLowerCase(),
      "surface-sunken": sunken.toLowerCase(),
      "surface-raised": raised.toLowerCase(),
      hairline: `#ffffff${alpha}`,
    });
  });

  test("is a dark color-scheme the system appearance can't flip to light", () => {
    expect(theme).toMatch(/\[data-theme="midnight"\]\s*\{\s*color-scheme: dark;/);
    expect(theme).toMatch(
      /@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme\]\)/
    );
  });

  test("uses dark's washes, scenes and halos", () => {
    const assets = read("../styles/assets.css");

    expect(assets).toMatch(
      /\[data-theme="dark"\],\s*\[data-theme="midnight"\]\s*\{[^}]*scene-night/
    );
    expect(assets).toMatch(
      /@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme\]\)/
    );
  });
});

describe("@polaris/ui/tokens", () => {
  test("imports nothing outside its folder, so apps/mobile needs no DOM or Tailwind", () => {
    const sources = readdirSync(new URL(".", import.meta.url)).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts")
    );

    expect(sources).toContain("index.ts");

    for (const file of sources) {
      for (const [, specifier] of read(`./${file}`).matchAll(/from\s+"([^"]+)"/g)) {
        expect(specifier).toMatch(/^\.\/[a-z-]+$/);
      }
    }
  });
});

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { source as chartJs } from "./chartjs.ts";
import { source as d3 } from "./d3.ts";
import { sha256Hex } from "./hash.ts";
import { CHART_JS_PIN, D3_PIN, type LibraryPin } from "./pins.ts";

const packageRoot = join(import.meta.dir, "..", "..");

const vendored: ReadonlyArray<readonly [LibraryPin, string]> = [
  [CHART_JS_PIN, chartJs],
  [D3_PIN, d3],
];

describe.each(vendored)("the vendored %p", (pin, source) => {
  test("matches its pinned sha256", () => {
    expect(sha256Hex(source)).toBe(pin.sha256);
  });

  test("can be inlined in a <script> without ending it early", () => {
    expect(/<\/script|<!--|<script/i.test(source)).toBe(false);
  });

  test("is the version its header names", () => {
    expect(source.slice(0, 200)).toContain(pin.version);
  });

  test("ships its licence text", () => {
    const path = join(packageRoot, "vendor", pin.licenseFile);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toMatch(
      pin.license === "MIT" ? /MIT License/ : /Permission to use, copy, modify/
    );
  });

  test("is recorded in the README with its version, licence and hash", () => {
    const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
    const row = readme.split("\n").find((line) => line.startsWith(`| \`${pin.npm}\` |`));
    expect(row).toContain(pin.version);
    expect(row).toContain(pin.license);
    expect(row).toContain(pin.sha256);
  });
});

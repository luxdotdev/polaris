/**
 * The Desktop App's rule that Main's internet goes through `internetFetch` (ADR 0053): the
 * committed override in apps/desktop/.oxlintrc.json, run on planted files.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { ROOT } from "../lint/oxlint.ts";

const Config = Schema.Struct({
  overrides: Schema.Array(
    Schema.Struct({
      files: Schema.Array(Schema.String),
      rules: Schema.Record(Schema.String, Schema.Unknown),
    })
  ),
});

const Report = Schema.Struct({
  diagnostics: Schema.Array(Schema.Struct({ code: Schema.String, filename: Schema.String })),
});

const desktop = Schema.decodeUnknownSync(Schema.fromJsonString(Config))(
  readFileSync(join(ROOT, "apps/desktop/.oxlintrc.json"), "utf8")
);

const dir = mkdtempSync(join(tmpdir(), "polaris-internet-fetch-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const plant = (path: string, text: string) => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), text);
};

test("a bare fetch in Main is reported; internetFetch, and fetch outside Main, are not", () => {
  // Only the Main override, so the planted files need no workspace or type information.
  const main = desktop.overrides.filter((o) => o.files.some((f) => f.startsWith("src/main/")));
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify({ overrides: main }));
  plant("src/main/planted.ts", 'export const leak = () => fetch("https://api.github.com/");\n');
  plant("src/main/nested/also.ts", 'export const leak = () => fetch("https://example.com/");\n');
  plant(
    "src/main/through.ts",
    'declare const internetFetch: (url: string) => Promise<Response>;\nexport const ok = () => internetFetch("https://api.github.com/");\n'
  );
  plant("src/renderer/elsewhere.ts", 'export const page = () => fetch("/local");\n');

  const run = Bun.spawnSync(
    ["node", join(ROOT, "node_modules/oxlint/bin/oxlint"), "--format", "json", "src"],
    { cwd: dir, env: { ...process.env, FORCE_COLOR: "0" } }
  );

  const report = Schema.decodeUnknownSync(Schema.fromJsonString(Report))(run.stdout.toString());

  expect(report.diagnostics.map((d) => `${d.code} ${d.filename}`).sort()).toEqual([
    "eslint(no-restricted-globals) src/main/nested/also.ts",
    "eslint(no-restricted-globals) src/main/planted.ts",
  ]);
}, 30_000);

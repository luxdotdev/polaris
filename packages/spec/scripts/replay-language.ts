#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Schema } from "effect";
import { LanguageTrace, languageTraceModule } from "./language-replay/index.ts";

const path = process.argv[2];

if (!path) throw new Error("Usage: bun packages/spec/scripts/replay-language.ts <trace.json>");

const trace = Schema.decodeUnknownSync(Schema.fromJsonString(LanguageTrace))(
  readFileSync(path, "utf8")
);

const directory = mkdtempSync(join(tmpdir(), "polaris-language-replay-"));

try {
  const generated = join(directory, "trace.qnt");

  writeFileSync(
    join(directory, "languages.qnt"),
    readFileSync(resolve(import.meta.dir, "../languages.qnt"))
  );

  writeFileSync(generated, languageTraceModule(trace, "./languages"));

  const result = Bun.spawnSync(
    [
      resolve(import.meta.dir, "../node_modules/.bin/quint"),
      "test",
      generated,
      "--main=language_contract_trace",
    ],
    { stdout: "inherit", stderr: "inherit" }
  );

  console.log(
    `Language trace v1: ${trace.events.length} events; source=${trace.source}; contract safety only`
  );
  process.exitCode = result.exitCode;
} finally {
  rmSync(directory, { recursive: true, force: true });
}

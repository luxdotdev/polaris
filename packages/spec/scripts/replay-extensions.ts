#!/usr/bin/env bun
/**
 * Trace validation for Extensions (ENG-398): replays a runtime trace from
 * `transport/extensions.test.ts` (`EXTENSIONS_TRACE_OUTPUT`) through the
 * reference in `extensions-replay/index.ts`, then as a Quint run against
 * `extensions.qnt`.
 *
 *   bun scripts/replay-extensions.ts /tmp/extensions.trace.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { decodeExtensionsTrace, replayExtensions, toQuint } from "./extensions-replay/index.ts";

const file = process.argv[2];

if (file === undefined) {
  console.error("usage: bun scripts/replay-extensions.ts <trace.json>");
  process.exit(2);
}

const specDir = join(import.meta.dir, "..");

const out = join(specDir, ".replay");

mkdirSync(out, { recursive: true });

const trace = decodeExtensionsTrace(JSON.parse(readFileSync(file, "utf8")));

replayExtensions(trace);

const name = `replay_extensions_${basename(file, ".json").replace(/[^A-Za-z0-9]/g, "_")}`;

const path = join(out, `${name}.qnt`);

writeFileSync(path, toQuint(name, trace));

const result = Bun.spawnSync(
  [join(specDir, "node_modules", ".bin", "quint"), "test", path, `--main=${name}`],
  { cwd: specDir, stdout: "pipe", stderr: "pipe" }
);

if (result.exitCode !== 0) {
  console.error(`✗ ${file}\n${result.stdout.toString()}${result.stderr.toString()}`);
  process.exit(1);
}

console.log(`✓ ${file}: ${trace.events.length} events conform to extensions.qnt`);

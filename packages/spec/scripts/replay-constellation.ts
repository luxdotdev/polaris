#!/usr/bin/env bun
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import {
  constellationTraceToQuint,
  decodeConstellationTrace,
} from "./constellation-replay/index.ts";

if (import.meta.main) {
  const input = process.argv[2];

  if (input === undefined) {
    console.error("usage: bun scripts/replay-constellation.ts <trace file or directory>");
    process.exit(2);
  }

  const specDir = join(import.meta.dir, "..");
  const out = mkdtempSync(join(tmpdir(), "polaris-constellation-replay-"));
  const path = resolve(input);

  const files = path.endsWith(".json")
    ? [path]
    : readdirSync(path)
        .filter((file) => file.endsWith(".json"))
        .sort()
        .map((file) => join(path, file));

  let failed = 0;
  let batches = 0;
  let events = 0;

  for (const [index, file] of files.entries()) {
    try {
      const trace = decodeConstellationTrace(readFileSync(file, "utf8"));

      const sources = constellationTraceToQuint(
        `trace_${index}`,
        trace,
        relative(out, join(specDir, "constellations"))
      );

      for (const source of sources) {
        const generated = join(out, `${source.name}.qnt`);
        writeFileSync(generated, source.source);

        const checked = Bun.spawnSync(
          [
            join(specDir, "node_modules", ".bin", "quint"),
            "test",
            generated,
            `--main=${source.name}`,
            "--backend=typescript",
          ],
          { cwd: specDir, stdout: "pipe", stderr: "pipe" }
        );

        if (checked.exitCode !== 0)
          throw new Error(`${generated}\n${checked.stdout.toString()}${checked.stderr.toString()}`);
        batches += source.batches;
        events += source.events;
      }

      console.log(`✓ ${basename(file)}`);
    } catch (error) {
      failed++;
      console.error(
        `✗ ${basename(file)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  console.log(
    `${files.length - failed}/${files.length} traces conform (${batches} batches, ${events} spec events)`
  );

  if (failed === 0) rmSync(out, { recursive: true, force: true });
  else console.error(`generated counterexamples retained in ${out}`);
  process.exit(failed === 0 && files.length > 0 ? 0 : 1);
}

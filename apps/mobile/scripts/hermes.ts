#!/usr/bin/env bun
/**
 * Runs the self-check on Hermes: bundles `src/runtime/hermesProbe.ts` into one script, compiles
 * it with `hermesc`, and runs it on the `hermes` VM when `hermes:build` has built one.
 *
 *   bun run --cwd apps/mobile hermes
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckResult } from "../src/runtime/selfCheck.ts";
import { appDir, hermescPath, hermesVersion, hermesVmPath } from "./hermesPaths.ts";

const MARKER = "POLARIS_SELF_CHECK ";

export interface HermesRun {
  /** `hermesc` compiled the bundle; its diagnostics otherwise. */
  readonly compiled: { readonly ok: boolean; readonly output: string };
  /** The self-check's results on the VM; null when no VM is built. */
  readonly results: ReadonlyArray<CheckResult> | null;
  readonly vmOutput: string;
}

const bundleProbe = async (): Promise<string> => {
  const built = await Bun.build({
    entrypoints: [join(appDir, "src", "runtime", "hermesProbe.ts")],
    target: "browser",
    format: "iife",
    // Metro's conditions for the shared runtime (metro.config.mjs adds "browser" for the SDK only).
    conditions: ["react-native"],
    define: { "process.env.NODE_ENV": '"production"' },
    // React Native declares `console`; the bare VM doesn't, and hermesc warns on marked's use of it.
    banner: "var console = globalThis.console;",
  });

  const output = built.outputs[0];

  if (!built.success || output === undefined) throw new AggregateError(built.logs, "bundle failed");

  return output.text();
};

const spawn = async (command: Array<string>) => {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { code, output: stdout + stderr };
};

export const runOnHermes = async (): Promise<HermesRun> => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-hermes-"));

  try {
    const script = join(dir, "probe.js");
    const bytecode = join(dir, "probe.hbc");

    writeFileSync(script, await bundleProbe());
    const compiled = await spawn([hermescPath(), "-emit-binary", "-out", bytecode, script]);
    const vm = hermesVmPath(hermesVersion());

    if (compiled.code !== 0 || !(await Bun.file(vm).exists())) {
      return {
        compiled: { ok: compiled.code === 0, output: compiled.output },
        results: null,
        vmOutput: "",
      };
    }

    const ran = await spawn([vm, bytecode]);
    const line = ran.output.split("\n").find((text) => text.startsWith(MARKER));

    // SAFETY: the probe prints `MARKER` followed by `JSON.stringify` of `CheckResult`s.
    const results =
      line === undefined ? [] : (JSON.parse(line.slice(MARKER.length)) as Array<CheckResult>);

    return { compiled: { ok: true, output: compiled.output }, results, vmOutput: ran.output };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

if (import.meta.main) {
  const run = await runOnHermes();

  if (!run.compiled.ok) {
    console.error(`hermesc refused the bundle:\n${run.compiled.output}`);
    process.exit(1);
  }

  if (run.results === null) {
    console.log(
      "hermesc compiled the bundle; no hermes VM (bun run hermes:build), so it did not run"
    );
    process.exit(0);
  }

  for (const result of run.results)
    console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}: ${result.detail}`);

  if (run.results.length === 0) console.error(run.vmOutput);

  process.exit(run.results.length > 0 && run.results.every((result) => result.ok) ? 0 : 1);
}

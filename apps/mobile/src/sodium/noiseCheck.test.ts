import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runNoiseChecks } from "./noiseCheck.ts";

const failures = (results: ReadonlyArray<{ ok: boolean; name: string; detail: string }>) =>
  results.flatMap((result) => (result.ok ? [] : [`${result.name}: ${result.detail}`]));

/**
 * Bundles the checks with `sodium-universal` resolved to `universal.ts`, as Metro does, and its
 * native module replaced by sodium-native behind the same contract; then runs them.
 */
const runThroughShim = async () => {
  const universal = join(import.meta.dir, "universal.ts");
  const native = join(import.meta.dir, "nativeOnBun.testing.ts");

  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, "shimProbe.testing.ts")],
    target: "bun",
    external: ["sodium-native"],
    plugins: [
      {
        name: "sodium-universal on the shim",
        setup: (build) => {
          build.onResolve({ filter: /^sodium-universal$/ }, () => ({ path: universal }));
          build.onResolve({ filter: /^\.\/native\.ts$/ }, () => ({ path: native }));
        },
      },
    ],
  });

  const output = built.outputs[0];

  if (!built.success || output === undefined) throw new AggregateError(built.logs, "bundle failed");
  // Inside the app, so the bundle's `sodium-native` resolves from its node_modules.
  const dir = mkdtempSync(join(import.meta.dir, "..", "..", "node_modules", ".shim-probe-"));

  try {
    const script = join(dir, "probe.js");
    await Bun.write(script, await output.text());
    const child = Bun.spawn(["bun", script], { stdout: "pipe", stderr: "pipe" });

    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    if ((await child.exited) !== 0) throw new Error(stderr);

    // SAFETY: the probe prints one line of `JSON.stringify({ results, nativeCalls })`.
    return JSON.parse(stdout) as {
      results: Array<{ ok: boolean; name: string; detail: string }>;
      nativeCalls: number;
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("the relay's cryptography", () => {
  test("matches the Noise IK vector and sodium-native's answers", async () => {
    const results = await runNoiseChecks();

    expect(results.length).toBe(3);
    expect(failures(results)).toEqual([]);
  });

  test("matches them through the shim the phone resolves sodium-universal to", async () => {
    const { results, nativeCalls } = await runThroughShim();

    expect(failures(results)).toEqual([]);
    expect(results.length).toBe(3);
    // The checks ran on the shim's native side, not on a sodium-universal left in the bundle.
    expect(nativeCalls).toBeGreaterThan(50);
  }, 60_000);
});

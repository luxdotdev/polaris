#!/usr/bin/env bun
/**
 * End to end on a real Windows Host over SSH (ADR 0060): builds two windows-x64
 * Daemons with different versions, then on the Host installs A as a scheduled
 * task, connects a real Client over the pipe, kills the Daemon (the task's loop
 * restarts it), upgrades to B (stop and restart; the Client reconnects and the
 * Agent Session survives), and uninstalls. Prints the Host's evidence.
 *
 *   bun apps/daemon/scripts/e2e-windows-service.ts --host <ssh alias> --dir <C:\scratch dir> \
 *     --bun <C:\path\to\bun.exe> [--a <polaris.exe> --b <polaris.exe>]
 *
 * Run it with Bun 1.4.3 or later (the build embeds the running Bun's Windows runtime).
 * It uses a throwaway POLARIS_HOME under --dir, so the task it creates is not the real one.
 */
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);

  return at >= 0 ? process.argv[at + 1] : undefined;
};

const required = (name: string): string => {
  const value = option(name);

  if (value === undefined) throw new Error(`missing ${name}`);

  return value;
};

const host = required("--host");

const dir = required("--dir");

const bun = required("--bun");

const run = (argv: ReadonlyArray<string>, cwd = root) => {
  const proc = Bun.spawnSync([...argv], { cwd, stdout: "inherit", stderr: "inherit" });

  if (proc.exitCode !== 0) throw new Error(`${argv.join(" ")} exited ${proc.exitCode}`);
};

const local = mkdtempSync(join(tmpdir(), "polaris-win-e2e-"));

/** A dev build's version carries the time when the tree is dirty, so two builds differ. */
const build = (name: string) => {
  run([process.execPath, "scripts/build-daemon.ts", "windows-x64"]);
  const out = join(local, name);
  copyFileSync(join(root, "apps", "daemon", "dist", "windows-x64", "polaris.exe"), out);

  return out;
};

const a = option("--a") ?? build("polaris-a.exe");

if (option("--a") === undefined) await Bun.sleep(1100);

const b = option("--b") ?? build("polaris-b.exe");

const bundled = await Bun.build({
  entrypoints: [join(import.meta.dir, "e2e-windows-service", "client.ts")],
  target: "bun",
  outdir: local,
  naming: "client.js",
});

if (!bundled.success) throw new Error(bundled.logs.map(String).join("\n"));

const remote = (path: string) => `${host}:${dir.replaceAll("\\", "/")}/${path}`;

const uploads: ReadonlyArray<readonly [string, string]> = [
  [a, "polaris-a.exe"],
  [b, "polaris-b.exe"],
  [join(local, "client.js"), "client.js"],
  [join(import.meta.dir, "e2e-windows-service", "steps.ps1"), "steps.ps1"],
];

run(["ssh", host, `New-Item -ItemType Directory -Force '${dir}' | Out-Null`]);

for (const [from, to] of uploads) run(["scp", "-q", from, remote(to)]);

run([
  "ssh",
  host,
  `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '${dir}\\steps.ps1' -Dir '${dir}' -Bun '${bun}'`,
]);

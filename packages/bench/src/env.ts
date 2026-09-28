/** The environment block stored with every result, and the machine slug baselines are named by. */
import { readFileSync } from "node:fs";
import { arch, cpus, release, totalmem, type } from "node:os";
import { REPO_ROOT, type TransportKind } from "./daemon.ts";
import { procReader } from "./proc.ts";
import type { Environment } from "./types.ts";

const run = (argv: ReadonlyArray<string>): string => {
  try {
    const out = Bun.spawnSync([...argv], { cwd: REPO_ROOT, stderr: "ignore" });
    return out.exitCode === 0 ? out.stdout.toString().trim() : "";
  } catch {
    return "";
  }
};

const read = (path: string): string => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
};

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const machineInfo = () => {
  if (process.platform === "darwin") {
    const model = run(["sysctl", "-n", "hw.model"]);
    const cpu = run(["sysctl", "-n", "machdep.cpu.brand_string"]);
    const version = run(["sw_vers", "-productVersion"]);
    return { machine: model || "Mac", cpu, os: `macOS ${version} (Darwin ${release()})` };
  }
  const product = read("/sys/devices/virtual/dmi/id/product_name");
  const board = read("/proc/device-tree/model").replace(/\0/g, "");
  const cpuinfo = read("/proc/cpuinfo");
  const known = (v: string | undefined) => (v?.trim() && v.trim() !== "unknown" ? v.trim() : null);
  // x86 has "model name"; arm64 kernels often only give lscpu's "Model name" (e.g. Cortex-A72).
  const cpu =
    known(/^model name\s*:\s*(.+)$/m.exec(cpuinfo)?.[1]) ??
    known(/^Model name:\s*(.+)$/m.exec(run(["lscpu"]))?.[1]) ??
    known(cpus()[0]?.model) ??
    arch();
  const osName = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(read("/etc/os-release"))?.[1] ?? type();
  return { machine: board || product || "Linux", cpu, os: `${osName} (${type()} ${release()})` };
};

export const environment = (options: {
  readonly binary: string | null;
  readonly transport: TransportKind;
}): Environment => {
  const info = machineInfo();
  const cores = cpus().length;
  return {
    machine: info.machine,
    machineSlug: slugify(`${info.machine}-${info.cpu}-${cores}c`),
    cpu: info.cpu,
    cores,
    memoryGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    os: info.os,
    arch: arch(),
    bun: Bun.version,
    gitSha: run(["git", "rev-parse", "--short=12", "HEAD"]),
    // Baselines being written are not a change to the code under test.
    gitDirty:
      run(["git", "status", "--porcelain", "--", ".", ":!packages/bench/baselines"]).length > 0,
    daemon: options.binary ? "compiled" : "source",
    daemonBinary: options.binary,
    transport: options.transport,
    sampler: procReader().backend,
    date: new Date().toISOString(),
  };
};

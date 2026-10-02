import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { open, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Schema } from "effect";
import { invalid, within } from "../trust/checkout.ts";

export const MAX_CONFIG_BYTES = 262144;

export const MAX_ANCESTORS = 64;

const budget = new AsyncLocalStorage<{
  probes: number;
  bytes: number;
  root: string;
  inputs: Map<string, string>;
}>();

export const withDiscoveryBudget = <A>(root: string, read: () => Promise<A>) => {
  const active = { probes: 0, bytes: 0, root, inputs: new Map<string, string>() };

  return budget.run(active, async () => ({
    value: await read(),
    configurationInputs: Object.fromEntries(active.inputs),
  }));
};

function countProbe() {
  const active = budget.getStore();

  if (active !== undefined && ++active.probes > 2048)
    throw invalid("Discovery filesystem probe limit exceeded");
}

export async function existing(root: string, path: string): Promise<string | null> {
  countProbe();

  if (!within(root, resolve(path))) throw invalid("Discovery path leaves checkout");

  try {
    const canonical = await realpath(path);

    if (!within(root, canonical)) throw invalid("Discovery symlink leaves checkout");

    const active = budget.getStore();

    if (active !== undefined) {
      const info = await stat(canonical, { bigint: true });
      active.inputs.set(
        canonical,
        createHash("sha256")
          .update(`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`)
          .digest("hex")
      );
    }

    return canonical;
  } catch (error) {
    if (Schema.is(Schema.Struct({ code: Schema.Literals(["ENOENT", "ENOTDIR"]) }))(error))
      return null;
    throw error;
  }
}

export function ancestors(root: string, start: string): string[] {
  const result: string[] = [];

  for (let path = start; within(root, path); path = dirname(path)) {
    result.push(path);

    if (path === root) return result;

    if (result.length >= MAX_ANCESTORS) throw invalid("Discovery ancestor limit exceeded");
  }

  throw invalid("Discovery root is outside checkout");
}

export async function nearest(
  root: string,
  directories: readonly string[],
  markers: readonly string[]
) {
  for (const directory of directories) {
    for (const marker of markers) {
      const path = await existing(root, join(directory, marker));

      if (path !== null) return { directory, path };
    }
  }

  return null;
}

export async function readText(path: string): Promise<string> {
  const active = budget.getStore();

  if (active !== undefined && (await existing(active.root, path)) !== path)
    throw invalid("Discovery config path changed");
  const before = await stat(path);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

  try {
    const info = await file.stat();

    if (info.dev !== before.dev || info.ino !== before.ino)
      throw invalid("Discovery config identity changed");

    if (active !== undefined && (await existing(active.root, path)) !== path)
      throw invalid("Discovery config path changed");

    if (!info.isFile() || info.size > MAX_CONFIG_BYTES)
      throw invalid("Discovery config is not a bounded regular file");
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);

    if (active !== undefined) {
      active.bytes += bytesRead;

      if (active.bytes > 4194304)
        throw invalid("Discovery configuration graph byte limit exceeded");
    }

    if (bytesRead > MAX_CONFIG_BYTES) throw invalid("Discovery config exceeds byte limit");

    const content = buffer.subarray(0, bytesRead);
    active?.inputs.set(path, createHash("sha256").update(content).digest("hex"));

    return content.toString("utf8");
  } finally {
    await file.close();
  }
}

export async function readJson(path: string) {
  return Schema.decodeUnknownSync(Schema.JsonObject)(JSON.parse(await readText(path)));
}

export async function isDirectory(path: string) {
  return (await stat(path)).isDirectory();
}

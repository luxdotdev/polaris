import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  canonicalTreeResource,
  snapshotTree,
  budget,
  ancestors,
  sameTree,
  statOrNull,
} from "../../files/edits/trees/snapshot.ts";
import { preparationLimits, requireActive } from "./contracts.ts";
import { readText } from "./text.ts";
import type { HostDelivery } from "./contracts.ts";
import type { LanguageEditSnapshot, LanguageResourceSnapshot } from "@polaris/protocol";

export const collectSnapshots = async (
  delivery: HostDelivery,
  paths: { text: ReadonlyMap<string, unknown>; resources: ReadonlySet<string> },
  signal: AbortSignal,
  verify: () => Promise<void>
) => {
  const root = delivery.fence.context.checkout.path;

  if (!isAbsolute(root) || resolve(root) !== root)
    throw new Error("Checkout root is not canonical.");
  const limit = budget();
  const names = new Map<string, string>();
  const snapshots: (typeof LanguageEditSnapshot.Type)[] = [];
  const resourceSnapshots: (typeof LanguageResourceSnapshot.Type)[] = [];
  const trees = new Map<string, Awaited<ReturnType<typeof snapshotTree>>>();
  const ownership = new Map<string, Awaited<ReturnType<typeof ancestors>>>();
  let textBytes = 0;

  for (const uri of new Set([...paths.text.keys(), ...paths.resources])) {
    requireActive(signal);
    await verify();
    const canonicalPath = await canonicalTreeResource(root, uri);

    if (pathToFileURL(canonicalPath).href !== uri || [...names.values()].includes(canonicalPath))
      throw new Error("Snapshot URI is aliased or noncanonical.");
    names.set(uri, canonicalPath);
    ownership.set(uri, await ancestors(root, canonicalPath));
    const stat = await statOrNull(canonicalPath);

    if (
      paths.text.has(uri) &&
      stat !== null &&
      (!stat.isFile() || stat.size > preparationLimits.fileBytes)
    )
      throw new Error("Text snapshot is not a bounded regular file.");
    const tree = await snapshotTree(root, canonicalPath, limit);
    trees.set(uri, tree);

    if (paths.text.has(uri)) {
      const diskText = await readText(root, canonicalPath, tree);
      textBytes += Buffer.byteLength(diskText ?? "");

      if (textBytes > preparationLimits.textBytes)
        throw new Error("Proposal text budget exceeded.");
      snapshots.push({
        uri,
        canonicalPath,
        diskText,
        diskVersion: tree?.entries[0]?.version ?? null,
        buffer: null,
      });
    }

    if (paths.resources.has(uri)) resourceSnapshots.push({ uri, canonicalPath, tree });
    await verify();
  }

  return { snapshots, resourceSnapshots, names, ownership, trees };
};

export const recheckSnapshots = async (
  delivery: HostDelivery,
  captured: Awaited<ReturnType<typeof collectSnapshots>>,
  signal: AbortSignal,
  verify: () => Promise<void>
) => {
  const root = delivery.fence.context.checkout.path;
  const limit = budget();

  for (const [uri, path] of captured.names) {
    requireActive(signal);
    await verify();

    if (
      (await canonicalTreeResource(root, uri)) !== path ||
      JSON.stringify(await ancestors(root, path)) !== JSON.stringify(captured.ownership.get(uri))
    )
      throw new Error("Snapshot ancestor ownership changed.");
    const observed = await snapshotTree(root, path, limit);

    if (!sameTree(captured.trees.get(uri) ?? null, observed))
      throw new Error("Resource changed while preparing proposal.");
    const text = captured.snapshots.find((snapshot) => snapshot.uri === uri);

    if (
      text &&
      ((await readText(root, path, observed)) !== text.diskText ||
        JSON.stringify(observed?.entries[0]?.version ?? null) !== JSON.stringify(text.diskVersion))
    )
      throw new Error("Text changed while preparing proposal.");
    await verify();
  }
};

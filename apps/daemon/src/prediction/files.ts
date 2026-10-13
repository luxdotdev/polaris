import { fstatSync, readSync, statSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { openPinned } from "../languages/media/native.ts";
import { within } from "../languages/trust/checkout.ts";
import { parseOutline, type Outline } from "./outline.ts";

const maxBytes = 131072;

const sameFile = (a: ReturnType<typeof fstatSync>, b: ReturnType<typeof fstatSync>) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;

/** Bounded, descriptor-relative reads reject symlink escapes and replaced roots. */
export async function readSource(root: string, path: string, signal: AbortSignal) {
  signal.throwIfAborted();

  if (!within(root, resolve(path))) return undefined;

  try {
    const canonical = await realpath(path);

    if (!within(root, canonical)) return undefined;
    const rootBefore = statSync(root, { bigint: true });
    const pinned = openPinned(root, canonical);

    try {
      if (pinned.root.dev !== rootBefore.dev || pinned.root.ino !== rootBefore.ino)
        return undefined;
      const before = fstatSync(pinned.fd);

      if (!before.isFile() || before.size > maxBytes) return undefined;
      const bytes = Buffer.alloc(Math.min(maxBytes + 1, before.size + 1));
      const length = readSync(pinned.fd, bytes, 0, bytes.length, 0);
      signal.throwIfAborted();

      if (length !== before.size || !sameFile(before, fstatSync(pinned.fd))) return undefined;
      const after = statSync(root, { bigint: true });

      if (after.dev !== rootBefore.dev || after.ino !== rootBefore.ino) return undefined;

      return { path: canonical, text: bytes.subarray(0, length).toString("utf8") };
    } finally {
      pinned.close();
    }
  } catch {
    signal.throwIfAborted();

    return undefined;
  }
}

export class OutlineCache {
  private readonly entries = new Map<string, { text: string; outline: Outline }>();
  async parse(path: string, text: string) {
    const cached = this.entries.get(path);

    if (cached?.text === text) return cached.outline;
    const outline = await parseOutline(path, text);
    this.entries.delete(path);

    if (text.length <= maxBytes) this.entries.set(path, { text, outline });

    while (this.entries.size > 32) this.entries.delete(this.entries.keys().next().value!);

    return outline;
  }
}

export async function importedSources(
  root: string,
  path: string,
  imports: readonly string[],
  signal: AbortSignal
) {
  const result: { path: string; text: string }[] = [];

  for (const spec of imports.slice(0, 8)) {
    signal.throwIfAborted();

    if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
    const base = resolve(dirname(path), spec.replace(/\.js$/, ""));

    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      join(base, "index.ts"),
      join(base, "index.tsx"),
    ]) {
      const source = await readSource(root, candidate, signal);

      if (source === undefined) continue;

      if (!result.some((item) => item.path === source.path)) result.push(source);
      break;
    }

    if (result.length >= 4) break;
  }

  return result;
}

export const sourceName = (root: string, path: string) =>
  relative(root, path).replaceAll("\\", "/");

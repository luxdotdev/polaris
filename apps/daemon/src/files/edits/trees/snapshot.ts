import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FileVersion,
  LanguageResourceIdentity,
  LanguageTreeManifest,
  languageTreeLimits,
} from "@polaris/protocol";
import { Schema } from "effect";
import { FileEditFailure } from "../failure.ts";
import { contained } from "../paths.ts";
import { fingerprint } from "../journal.ts";

export function fail(message: string): never {
  throw new FileEditFailure({ code: "disk-conflict", message });
}

export const resourceIdentity = (stat: Stats) =>
  Schema.decodeUnknownSync(LanguageResourceIdentity)({
    device: stat.dev,
    inode: stat.ino,
    mode: stat.mode & 0o7777,
  });

export type Identity = typeof LanguageResourceIdentity.Type;

export const sameTree = (a: LanguageTreeManifest | null, b: LanguageTreeManifest | null) =>
  fingerprint(a) === fingerprint(b);

export const sameIdentity = (a: Identity, b: Identity) => fingerprint(a) === fingerprint(b);

export const statOrNull = async (path: string) =>
  lstat(path).catch((cause: unknown) => {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
    throw cause;
  });

/** Check every existing ancestor without resolving through a link. Missing ancestors own absence only. */
export const ancestors = async (root: string, path: string) => {
  if (path !== root && !contained(root, path)) fail("Resource escapes checkout");
  const names = (path === root ? "" : relative(root, dirname(path))).split("/").filter(Boolean);
  const result: { path: string; identity: Identity }[] = [];
  let at = root;

  for (const name of ["", ...names]) {
    at = name ? join(at, name) : at;
    const stat = await statOrNull(at);

    if (!stat) break;

    if (!stat.isDirectory() || (await realpath(at)) !== at)
      fail("Resource ancestor is replaced, aliased or unsafe");
    result.push({ path: at, identity: resourceIdentity(stat) });
  }

  return result;
};

export const canonicalTreeResource = async (root: string, uri: string) => {
  if (
    decodeURIComponent(uri)
      .split("/")
      .some((part) => part === "." || part === "..") ||
    uri.includes("\\")
  )
    fail("Resource URI contains traversal or unsafe separators");
  const url = new URL(uri);

  if (
    url.protocol !== "file:" ||
    url.search ||
    url.hash ||
    (url.hostname && url.hostname !== "localhost")
  )
    fail("Resource requires a local file URI");
  const path = fileURLToPath(url);

  if (!contained(root, path)) fail("Resource escapes checkout or targets checkout root");
  await ancestors(root, path);
  const stat = await statOrNull(path);

  if (stat && (stat.isSymbolicLink() || (await realpath(path)) !== path))
    fail("Resource link or canonical alias is unsupported");

  return path;
};

export interface Budget {
  entries: number;
  bytes: number;
}

export const budget = (): Budget => ({ entries: 0, bytes: 0 });

const stable = (a: Stats, b: Stats) =>
  sameIdentity(resourceIdentity(a), resourceIdentity(b)) &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;

const fileVersion = async (path: string, stat: Stats, limit: Budget) => {
  limit.bytes += stat.size;

  if (limit.bytes > languageTreeLimits.bytes) fail("Tree exceeds hash-read byte budget");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    if (!stable(stat, await handle.stat())) fail("File replaced before no-follow read");
    const hash = createHash("sha256");
    const buffer = new Uint8Array(65536);
    let size = 0;

    while (true) {
      const result = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, stat.size - size + 1),
        size
      );

      if (result.bytesRead === 0) break;
      size += result.bytesRead;

      if (size > stat.size) fail("File grew while snapshotting");
      hash.update(buffer.subarray(0, result.bytesRead));
    }

    if (
      size !== stat.size ||
      !stable(stat, await handle.stat()) ||
      !stable(stat, await lstat(path))
    )
      fail("File changed while snapshotting");

    return new FileVersion({ size, mtimeMs: stat.mtimeMs, hash: hash.digest("hex") });
  } finally {
    await handle.close();
  }
};

export type SnapshotObserver = (
  point: "observed" | "directory-open",
  path: string
) => Promise<void>;

export const snapshotTree = async (
  root: string,
  path: string,
  limit = budget(),
  observe: SnapshotObserver = async () => {}
): Promise<LanguageTreeManifest | null> => {
  const parents = await ancestors(root, path);
  const initial = await statOrNull(path);

  if (!initial) return null;
  const entries: LanguageTreeManifest["entries"][number][] = [];

  const visit = async (current: string, suffix: string, depth: number): Promise<void> => {
    if (++limit.entries > languageTreeLimits.entries || depth > languageTreeLimits.depth)
      fail("Tree exceeds entry/depth budget");
    await ancestors(root, current);
    const stat = await lstat(current);

    if ((!stat.isFile() && !stat.isDirectory()) || (await realpath(current)) !== current)
      fail("Tree contains unsupported link, alias or special entry");
    const version = stat.isFile() ? await fileVersion(current, stat, limit) : null;
    entries.push({
      relativePath: suffix,
      kind: stat.isFile() ? "file" : "directory",
      identity: resourceIdentity(stat),
      version,
    });

    await observe("observed", current);

    if (stat.isDirectory()) {
      await observe("directory-open", current);

      if (!stable(stat, await lstat(current)) || (await realpath(current)) !== current)
        fail("Directory replaced before enumeration");
      const directory = await opendir(current);

      for await (const child of directory) {
        await visit(
          join(current, child.name),
          suffix ? `${suffix}/${child.name}` : child.name,
          depth + 1
        );
      }

      if (!stable(stat, await lstat(current))) fail("Directory changed while snapshotting");
    }
  };

  await visit(path, "", 0);

  if (!stable(initial, await lstat(path))) fail("Snapshot root changed");

  for (const parent of parents) {
    const stat = await lstat(parent.path);

    if (
      !stat.isDirectory() ||
      !sameIdentity(parent.identity, resourceIdentity(stat)) ||
      (await realpath(parent.path)) !== parent.path
    )
      fail("Snapshot parent replaced");
  }

  entries.sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : Number(a.relativePath > b.relativePath)
  );

  return Schema.decodeUnknownSync(LanguageTreeManifest)({ format: 1, entries });
};

/**
 * The disk side of `SecureStorage.files`: one `<dir>/<key>.bin` per key, written atomically,
 * and the one-time adoption of records sealed before it existed. See ADR 0044.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Option, Schema } from "effect";
import { SecretKey, type Sealer } from "./model.ts";

/** A directory of `<name>.bin` records sealed by the same sealer before `SecureStorage` existed. */
export interface Adoption {
  readonly from: string;
  /** Their key prefix: `github/tokens` adopts `<from>/1001.bin` as `github/tokens/1001`. */
  readonly prefix: string;
}

export interface FilesInput {
  /** `<userData>/secure`. */
  readonly dir: string;
  readonly sealer: Sealer;
  /** Moved in once, when the store opens; the sealing is the same, so it's a rename. */
  readonly adopt?: ReadonlyArray<Adoption>;
}

const isKey = Schema.is(SecretKey);

export const pathOf = (dir: string, key: string) => `${join(dir, ...key.split("/"))}.bin`;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false
  );

/** Moves one legacy record into place, unless the store already holds a newer one. */
const adoptOne = async (dir: string, from: string, key: string) => {
  const target = pathOf(dir, key);

  if (await exists(target)) return rm(from, { force: true });

  await mkdir(dirname(target), { recursive: true, mode: 0o700 });

  return rename(from, target);
};

export const adoptAll = async (dir: string, { from, prefix }: Adoption) => {
  const names = await readdir(from).catch(() => []);

  for (const name of names) {
    const key = `${prefix}/${name.replace(/\.bin$/, "")}`;

    if (name.endsWith(".bin") && isKey(key)) await adoptOne(dir, join(from, name), key);
  }

  // Only removes it once empty; anything left behind stays where it was.
  await rmdir(from).catch(() => undefined);
};

/** None when nothing is stored at `path`; any other failure rejects. */
export const readSealed = async (path: string) => {
  if (!(await exists(path))) return Option.none<Uint8Array>();

  return Option.some(new Uint8Array(await readFile(path)));
};

/** Writes through a temporary sibling, so a crash never leaves half a record. */
export const writeAtomically = async (path: string, data: Uint8Array) => {
  const part = `${path}.${randomBytes(8).toString("hex")}.part`;

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(part, data, { mode: 0o600 });

  try {
    await rename(part, path);
  } finally {
    await rm(part, { force: true });
  }
};

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, realpath, rename, rm, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ChangedOnDisk, type FileVersion } from "@polaris/protocol";
import { FsFailure, resolveHostPath, statPath, toFsFailure } from "./fs.ts";
import { currentVersion, readVersioned, sameVersion } from "./version.ts";
import { trashPath } from "./trash.ts";

const pending = new Map<string, Promise<void>>();

const mutationPath = async (input: string) => {
  const path = resolveHostPath(input);

  return join(await realpath(dirname(path)), basename(path));
};

/** Serializes Daemon mutations of a canonical path; external writers are rechecked before rename. */
export const withFileMutation = async <A>(path: string, run: () => Promise<A>): Promise<A> => {
  const previous = pending.get(path) ?? Promise.resolve();
  let release!: () => void;

  const next = new Promise<void>((resolve) => {
    release = resolve;
  });

  pending.set(path, next);
  await previous;

  try {
    return await run();
  } finally {
    release();

    if (pending.get(path) === next) pending.delete(path);
  }
};

export const writeVersioned = async (
  input: string,
  bytes: Uint8Array,
  expected: FileVersion
): Promise<FileVersion> => {
  const requested = resolveHostPath(input);
  let path: string;

  try {
    path = await realpath(requested);
  } catch (cause) {
    if ((await currentVersion(requested)) === null)
      throw new ChangedOnDisk({ path: requested, current: null });
    throw cause;
  }

  return withFileMutation(path, async () => {
    const before = await readVersioned(path).catch(async (cause: unknown) => {
      if ((await currentVersion(path)) === null)
        throw new ChangedOnDisk({ path: requested, current: null });
      throw cause;
    });

    if (!sameVersion(before.version, expected))
      throw new ChangedOnDisk({ path: requested, current: before.version });
    await access(path, constants.W_OK);
    const temp = join(dirname(path), `.polaris-save-${randomUUID()}`);

    try {
      const handle = await open(temp, "wx", before.mode & 0o7777);

      try {
        await handle.writeFile(bytes);
        await handle.chmod(before.mode & 0o7777);
        await handle.sync();
      } finally {
        await handle.close();
      }

      const written = (await readVersioned(temp)).version;
      const current = await currentVersion(path);

      if (!sameVersion(current, expected) || (await realpath(requested).catch(() => null)) !== path)
        throw new ChangedOnDisk({ path: requested, current: await currentVersion(requested) });
      await rename(temp, path);

      return written;
    } finally {
      await unlink(temp).catch(() => {});
    }
  });
};

export const createPath = async (input: string, kind: "file" | "directory") => {
  const path = await mutationPath(input);

  return withFileMutation(path, async () => {
    if (kind === "directory") await mkdir(path);
    else {
      const handle = await open(path, "wx", 0o666);
      await handle.close();
    }

    return statPath(path);
  });
};

export const renamePath = async (input: string, destination: string) => {
  const path = await mutationPath(input);
  const target = await mutationPath(destination);

  if (path === target) return statPath(path);
  // Sorted acquisition prevents opposite renames from deadlocking.
  const paths = [path, target].sort();

  return withFileMutation(paths[0]!, () =>
    withFileMutation(paths[1]!, async () => {
      const existing = await lstat(target).catch((cause: unknown) => {
        if (toFsFailure(target, cause).code === "ENOENT") return null;
        throw cause;
      });

      if (existing) throw new FsFailure(target, "EEXIST", "destination already exists");
      await rename(path, target);

      return statPath(target);
    })
  );
};

export const deletePath = async (
  input: string,
  permanent: boolean
): Promise<{ method: "trash" | "permanent" }> => {
  const path = await mutationPath(input);

  return withFileMutation(path, async () => {
    if (permanent) {
      await rm(path, { recursive: true });

      return { method: "permanent" };
    }

    await trashPath(path);

    return { method: "trash" };
  });
};

import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { FsFailure } from "./fs.ts";

export const supportsTrash = process.platform === "darwin" || process.platform === "linux";

const MAC_TRASH = `ObjC.import('Foundation');
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const result = Ref(), error = Ref();
  if (!$.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError(url, result, error)) {
    throw Error(ObjC.unwrap(error[0].localizedDescription));
  }
}`;

const macTrash = async (path: string): Promise<void> => {
  const child = Bun.spawn(["/usr/bin/osascript", "-l", "JavaScript", "-e", MAC_TRASH, path], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });

  const message = await new Response(child.stderr).text();

  if ((await child.exited) !== 0)
    throw new FsFailure(path, "ETRASH", message.trim() || "could not move to Trash");
};

const localDeletionDate = () => {
  const now = new Date();

  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
};

/** Freedesktop home trash; a different filesystem requires explicit permanent-delete confirmation. */
export const linuxTrash = async (path: string, dataHome: string): Promise<void> => {
  const trash = join(dataHome, "Trash");
  const files = join(trash, "files");
  const info = join(trash, "info");
  await mkdir(files, { recursive: true, mode: 0o700 });
  await mkdir(info, { recursive: true, mode: 0o700 });
  const source = await lstat(path);

  if (source.dev !== (await stat(files)).dev)
    throw new FsFailure(
      path,
      "ENOTSUP",
      "Trash is on a different filesystem; confirm permanent deletion"
    );
  const name = `${basename(path)}-${randomUUID()}`;
  const metadata = join(info, `${name}.trashinfo`);
  const handle = await open(metadata, "wx", 0o600);

  try {
    await handle.writeFile(
      `[Trash Info]\nPath=${encodeURI(path).replaceAll("#", "%23").replaceAll("?", "%3F")}\nDeletionDate=${localDeletionDate()}\n`
    );
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(path, join(files, name));
  } catch (cause) {
    await unlink(metadata);
    throw cause;
  }
};

export const trashPath = async (path: string): Promise<void> => {
  if (process.platform === "darwin") return macTrash(path);

  if (process.platform === "linux")
    return linuxTrash(path, process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"));
  throw new FsFailure(path, "ENOTSUP", "Trash is unavailable; confirm permanent deletion");
};

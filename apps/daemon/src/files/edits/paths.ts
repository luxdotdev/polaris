import { FileEditFailure } from "./failure.ts";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { currentVersion } from "../version.ts";

export const contained = (root: string, path: string) => {
  const suffix = relative(root, path);

  return (
    suffix !== "" &&
    suffix !== ".." &&
    !suffix.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(suffix)
  );
};

export const canonicalResource = async (root: string, uri: string) => {
  const url = new URL(uri);

  if (
    url.protocol !== "file:" ||
    url.search ||
    url.hash ||
    (url.hostname && url.hostname !== "localhost")
  )
    throw new FileEditFailure({
      code: "unsupported-resource",
      message: "Resource operations require local file URIs",
    });
  const requested = fileURLToPath(url);
  const path = join(await realpath(dirname(requested)), basename(requested));

  if (!contained(root, path))
    throw new FileEditFailure({
      code: "invalid-operation",
      message: "Resource path escapes checkout",
    });
  const version = await validatePath(root, path);

  return version === null ? path : realpath(path);
};

export const validatePath = async (root: string, path: string) => {
  if (!contained(root, path) || (await realpath(dirname(path))) !== dirname(path))
    throw new FileEditFailure({
      code: "invalid-operation",
      message: "Resource parent changed or escapes checkout",
    });

  const entry = await lstat(path).catch((cause: unknown) => {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
    throw cause;
  });

  if (entry && !entry.isFile())
    throw new FileEditFailure({
      code: "unsupported-resource",
      message: "Only regular files support recoverable resource operations",
    });

  return currentVersion(path);
};

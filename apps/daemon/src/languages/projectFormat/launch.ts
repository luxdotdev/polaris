import { open, realpath, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { LanguageProjectFormatterTool } from "@polaris/protocol";
import { currentLanguagePlatform } from "../composition/environment.ts";
import { ancestors, formatterBinary } from "./detect.ts";

/** The argv to spawn, and the private Node it needs (first on the child's PATH), if any. */
export type FormatterLaunch =
  | { readonly ok: true; readonly argv: readonly string[]; readonly node: string | null }
  | { readonly ok: false; readonly message: string };

/** Resolves the managed private Node's executable; never Node from PATH (ADR 0019). */
export type PrivateNode = () => Promise<string | null>;

const libcs = () => {
  const libc = currentLanguagePlatform()?.libc;

  return libc === "musl" ? ["musl", "glibc"] : ["glibc", "musl"];
};

/** Platform packages that ship the tool as a native binary, in the order they're tried. */
export const nativePackages = (tool: LanguageProjectFormatterTool): string[] => {
  const os = process.platform;
  const arch = process.arch;

  if (tool === "biome")
    return os === "linux"
      ? libcs().map((libc) => `@biomejs/cli-linux-${arch}${libc === "musl" ? "-musl" : ""}/biome`)
      : [`@biomejs/cli-${os}-${arch}/biome`];

  if (tool === "dprint")
    return os === "linux"
      ? libcs().map((libc) => `@dprint/linux-${arch}-${libc}/dprint`)
      : [`@dprint/${os}-${arch}/dprint`];

  return [];
};

const isFile = async (path: string) => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

const nativeBinary = async (
  checkoutRoot: string,
  formatterRoot: string,
  tool: LanguageProjectFormatterTool
) => {
  for (const directory of ancestors(checkoutRoot, join(formatterRoot, "_")))
    for (const name of nativePackages(tool)) {
      const candidate = join(directory, "node_modules", name);

      if (await isFile(candidate)) return candidate;
    }

  return null;
};

/** The first line of a file, if it starts with `#!`. */
const shebang = async (path: string) => {
  const handle = await open(path, "r");

  try {
    const buffer = Buffer.alloc(256);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead).toString("utf8");

    return head.startsWith("#!") ? (head.split("\n")[0] ?? "") : null;
  } finally {
    await handle.close();
  }
};

type EntryKind = "node-script" | "shell-shim" | "native";

const entryKind = async (path: string): Promise<EntryKind> => {
  const line = await shebang(path);

  if (line === null)
    return [".js", ".cjs", ".mjs"].includes(extname(path)) ? "node-script" : "native";

  return /\bnode\b/.test(line) ? "node-script" : "shell-shim";
};

const NO_NODE = "Polaris's private Node isn't installed on this Host yet";

/**
 * A native binary runs directly. A Node entry point runs as `[privateNode, entry]`; a shell shim
 * runs directly with the private Node first on its PATH, so its `node` resolves to ours.
 */
export async function formatterLaunch(
  checkoutRoot: string,
  formatterRoot: string,
  tool: LanguageProjectFormatterTool,
  privateNode: PrivateNode
): Promise<FormatterLaunch> {
  const native = await nativeBinary(checkoutRoot, formatterRoot, tool);

  if (native !== null) return { ok: true, argv: [native], node: null };
  const shim = await formatterBinary(checkoutRoot, formatterRoot, tool);

  if (shim === null)
    return { ok: false, message: `${tool} isn't installed in this checkout's node_modules` };
  const entry = await realpath(shim);
  const kind = await entryKind(entry);

  if (kind === "native") return { ok: true, argv: [entry], node: null };
  const node = await privateNode();

  if (node === null) return { ok: false, message: NO_NODE };

  return { ok: true, argv: kind === "node-script" ? [node, entry] : [shim], node };
}

/** The child's PATH: the private Node's directory first, then the Daemon's own. */
export const formatterPath = (node: string | null, path = process.env.PATH ?? "") =>
  node === null ? path : [dirname(node), ...(path === "" ? [] : [path])].join(":");

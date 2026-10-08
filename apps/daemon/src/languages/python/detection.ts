import { readlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Schema } from "effect";
import type { LanguagePythonInterpreter } from "@polaris/protocol";
import { ancestors, existing, readText } from "../discovery/files.ts";
import { interpreterEntry } from "./environment.ts";
import { createHostPrerequisiteProbe } from "../install/hostStateProbes.ts";
import { catalog } from "../catalog/index.ts";

export type PythonCandidate = typeof LanguagePythonInterpreter.Type;

export type PythonProbeOptions = Parameters<typeof createHostPrerequisiteProbe>[0];

const absent = Schema.Struct({ code: Schema.Literals(["ENOENT", "ENOTDIR"]) });

async function uvProject(root: string, directory: string) {
  if (await existing(root, join(directory, "uv.lock"))) return true;
  const pyproject = await existing(root, join(directory, "pyproject.toml"));

  if (pyproject === null) return false;

  const parsed = Schema.decodeUnknownSync(
    Schema.Struct({
      tool: Schema.optionalKey(Schema.Struct({ uv: Schema.optionalKey(Schema.JsonObject) })),
    })
  )(Bun.TOML.parse(await readText(pyproject)));

  return parsed.tool?.uv !== undefined;
}

/** Read venv entry paths and bounded standard Host locations; never invoke project code. */
export async function detectPython(
  root: string,
  start: string,
  platform: NodeJS.Platform,
  hostOptions?: PythonProbeOptions
) {
  const candidates = await venvCandidates(root, start, platform);

  const requirement = catalog.tools
    .find((tool) => tool.id === "basedpyright")
    ?.requirements.find((item) => item.id === "python-interpreter");

  if (requirement !== undefined) {
    const host = await createHostPrerequisiteProbe(hostOptions)().probe(
      requirement,
      AbortSignal.timeout(2000)
    );

    if (
      host.presence === "present" &&
      host.path !== null &&
      !candidates.some((item) => item.path === host.path)
    )
      candidates.push(
        withVersion({ path: host.path, source: "host" }, await nameVersion(host.path))
      );
  }

  return candidates;
}

async function venvCandidates(root: string, start: string, platform: NodeJS.Platform) {
  const candidates: PythonCandidate[] = [];
  const suffix = platform === "win32" ? "Scripts/python.exe" : "bin/python";

  for (const directory of ancestors(root, start)) {
    const uv = await uvProject(root, directory);

    for (const name of [".venv", "venv"]) {
      const candidate = await venvCandidate(root, join(directory, name, suffix), uv);

      if (candidate !== null) candidates.push(candidate);

      if (candidates.length >= 31) return candidates;
    }
  }

  return candidates;
}

async function venvCandidate(
  root: string,
  path: string,
  uv: boolean
): Promise<PythonCandidate | null> {
  if ((await existing(root, dirname(path))) === null) return null;

  try {
    const entry = await interpreterEntry(path);
    const cfg = await existing(root, join(dirname(dirname(path)), "pyvenv.cfg"));
    const version = cfg === null ? null : cfgVersion(await readText(cfg));

    return withVersion({ path: entry.path, source: uv ? "uv" : "venv" }, version);
  } catch (cause) {
    if (!Schema.is(absent)(cause)) throw cause;

    return null;
  }
}

const CFG_VERSION = /^\s*version(?:_info)?\s*=\s*(\d+\.\d+(?:\.\d+)?)\b/m;

const NAME_VERSION = /^python(\d+\.\d+)$/;

/** pyvenv.cfg's `version` (venv) or `version_info` (uv). */
export const cfgVersion = (text: string) => CFG_VERSION.exec(text)?.[1] ?? null;

/** "python3.12", as the entry or a link on its way to the file is named (Homebrew's python3). */
export async function nameVersion(path: string) {
  let current = path;

  for (let hop = 0; hop < 8; hop++) {
    const named = NAME_VERSION.exec(basename(current))?.[1];

    if (named !== undefined) return named;

    try {
      current = resolve(dirname(current), await readlink(current));
    } catch {
      return null;
    }
  }

  return null;
}

/** An interpreter outside detection (an override): its venv's pyvenv.cfg, else its name. */
export async function interpreterVersion(path: string) {
  try {
    const version = cfgVersion(await readText(join(dirname(dirname(path)), "pyvenv.cfg")));

    if (version !== null) return version;
  } catch {
    // No venv around it, or an unreadable one: fall back to the name.
  }

  return nameVersion(path);
}

export const withVersion = (candidate: PythonCandidate, version: string | null): PythonCandidate =>
  version === null ? candidate : { ...candidate, version };

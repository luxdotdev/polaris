import { dirname, join } from "node:path";
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
      candidates.push({ path: host.path, source: "host" });
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

    return { path: entry.path, source: uv ? "uv" : "venv" };
  } catch (cause) {
    if (!Schema.is(absent)(cause)) throw cause;

    return null;
  }
}

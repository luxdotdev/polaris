import { Schema } from "effect";
import { upstreamEvidence } from "../catalog/upstreamEvidence.ts";
import { gunzip, tarEntries } from "./archive.ts";
import { upstreamRuntimeLimits, type ExactArtifact, type ArtifactPayload } from "./types.ts";
import { checkAbort, failure, verifyIntegrity } from "./validation.ts";

export const upstreamLimits = upstreamRuntimeLimits;

export const pluginGuard =
  'const ts = require("./lib/typescript.js");\nts.sys.require = undefined;\nts.sys.importPlugin = undefined;\n';

const EvidenceKey = Schema.Literals(Object.keys(upstreamEvidence));

/** Pinned upstream archives only; Node retains its executable and licence, never npm or package scripts. */
export async function decodeUpstream(
  bytes: Uint8Array,
  exact: ExactArtifact,
  signal: AbortSignal
): Promise<ArtifactPayload> {
  checkAbort(signal);

  if (!verifyIntegrity(bytes, exact.artifact.integrity))
    throw failure("audit-required", "Upstream artifact checksum does not match");
  const key = Schema.decodeUnknownSync(EvidenceKey)(exact.artifact.id);
  // SAFETY: EvidenceKey contains precisely the keys of this bundled evidence map.
  const evidence = upstreamEvidence[key as keyof typeof upstreamEvidence];
  const manifestBytes = Buffer.from(JSON.stringify(evidence.manifest, null, 2) + "\n");
  const isNode = exact.tool.id === "node";

  const prefix = isNode
    ? `node-v${exact.tool.version}-${exact.platform.os}-${exact.platform.arch}/`
    : "package/";

  const archive = await gunzip(bytes, signal, upstreamLimits.expandedBytes);

  const select = isNode
    ? (path: string) => path === prefix + "bin/node" || path === prefix + "LICENSE"
    : undefined;

  const entries = tarEntries(archive, signal, upstreamLimits, select)
    .filter((entry) => entry.path !== prefix.slice(0, -1))
    .map((entry) => {
      if (!entry.path.startsWith(prefix))
        throw failure("install-failed", "Upstream archive has an unexpected root");

      return { ...entry, path: entry.path.slice(prefix.length) };
    });

  for (const [path, notice] of Object.entries(evidence.notices))
    entries.push({
      path,
      kind: "file",
      mode: 0o644,
      bytes: Buffer.from(notice),
    });

  if (exact.tool.id === "typescript")
    entries.push({
      path: "plugin-guard.cjs",
      kind: "file",
      mode: 0o644,
      bytes: Buffer.from(pluginGuard),
    });

  return { manifestBytes, entries };
}

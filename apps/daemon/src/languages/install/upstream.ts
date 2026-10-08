import sqlServer from "../sql/server.txt" with { type: "text" };
import { npmDependencies } from "./npmDependencies.ts";
import { webEvidence } from "./webEvidence.ts";
import { webDependencies } from "./webDependencies.ts";
import prismaGuard from "../web/prisma-guard.txt" with { type: "text" };
import { Schema } from "effect";
import { upstreamEvidence } from "../catalog/upstreamEvidence.ts";
import { gunzip, tarEntries } from "./archive.ts";
import { upstreamRuntimeLimits, type ExactArtifact, type ArtifactPayload } from "./types.ts";
import { checkAbort, failure, verifyIntegrity } from "./validation.ts";

import ruffLicense from "../catalog/upstream-evidence/python-notice-2597d854122b77ddc71971564ca2350a37608575ce324adc5650a2b2051c8f18.txt" with { type: "text" };
import pythonGuard from "../python/guard.txt" with { type: "text" };

export const upstreamLimits = upstreamRuntimeLimits;

export const pluginGuard =
  'const ts = require("./lib/typescript.js");\nts.sys.require = undefined;\nts.sys.importPlugin = undefined;\n';

const combinedEvidence = { ...upstreamEvidence, ...webEvidence };

const EvidenceKey = Schema.Literals(Object.keys(combinedEvidence));

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
  const evidence = combinedEvidence[key as keyof typeof combinedEvidence];
  const manifestBytes = Buffer.from(JSON.stringify(evidence.manifest, null, 2) + "\n");
  const isNode = exact.tool.id === "node";

  const prefix = archivePrefix(exact);

  if (exact.artifact.format === "binary")
    return {
      manifestBytes,
      entries: [
        { path: exact.artifact.entry, kind: "file", mode: 0o755, bytes },
        ...Object.entries(evidence.notices).map(([path, notice]) => ({
          path,
          kind: "file" as const,
          mode: 0o644,
          bytes: Buffer.from(notice),
        })),
      ],
    };
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

  if ("dependencies" in evidence)
    entries.push(...(await webDependencies(evidence.dependencies, exact, signal)));

  if (exact.tool.id === "prisma-language-server")
    entries.push({
      path: "prisma-guard.cjs",
      kind: "file",
      mode: 0o644,
      bytes: Buffer.from(prismaGuard),
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

  if (exact.tool.id === "ruff")
    entries.push({ path: "LICENSE", kind: "file", mode: 0o644, bytes: Buffer.from(ruffLicense) });

  if (exact.tool.id === "basedpyright")
    entries.push({
      path: "python-guard.cjs",
      kind: "file",
      mode: 0o644,
      bytes: Buffer.from(pythonGuard),
    });

  entries.push(...(await npmDependencies(exact, signal)));

  entries.push(...sqlSupplement(exact.tool.id));

  return { manifestBytes, entries };
}

function sqlSupplement(toolId: string) {
  return toolId === "sqllens-language-server"
    ? [
        {
          path: "polaris-sql.mjs",
          kind: "file" as const,
          mode: 0o644,
          bytes: Buffer.from(sqlServer),
        },
      ]
    : [];
}

function archivePrefix(exact: ExactArtifact) {
  if (exact.tool.id === "node")
    return `node-v${exact.tool.version}-${exact.platform.os}-${exact.platform.arch}/`;

  return exact.tool.id === "ruff" ? "" : "package/";
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { catalog } from "../../apps/daemon/src/languages/catalog";
import type { Artifact } from "../../apps/daemon/src/languages/catalog/model";
import {
  AuditManifest,
  verifyIntegrity,
  safeArchivePath,
} from "../../apps/daemon/src/languages/catalog/verification";
import { auditBundle, readBundle } from "./audit";

interface ReferenceFile {
  readonly path: string;
  readonly integrity: string;
}

const checkFiles = (files: ReadonlyArray<ReferenceFile>): ReadonlyArray<string> =>
  files.flatMap((file) => {
    if (!safeArchivePath(file.path)) return [`unsafe-reference:${file.path}`];

    return verifyIntegrity(readFileSync(join(import.meta.dir, file.path)), file.integrity)
      ? []
      : [`reference-integrity:${file.path}`];
  });

const checkNpm = (artifact: Artifact, manifest: AuditManifest): ReadonlyArray<string> => {
  if (!artifact.bundle) return [];

  const failures: Array<string> = [];
  const bundlePath = join(import.meta.dir, "bundles", `${artifact.bundle}.json`);

  if (
    !manifest.bundleIntegrity ||
    !verifyIntegrity(readFileSync(bundlePath), manifest.bundleIntegrity)
  )
    failures.push(`${artifact.id}: frozen-bundle-integrity`);

  const bundle = readBundle(bundlePath);
  const problems = auditBundle({ bundle, noticeRoot: join(import.meta.dir, "notices") });
  const rootName = Object.keys(bundle.manifest.dependencies)[0];
  const root = bundle.packages.find((pkg) => pkg.location === `node_modules/${rootName}`);

  if (root?.integrity !== artifact.integrity || root?.url !== artifact.url)
    failures.push(`${artifact.id}: npm-root-identity`);

  if (artifact.audit === "verified" && problems.length > 0)
    failures.push(`${artifact.id}: unjustified-verified`);

  if (artifact.audit === "pending" && artifact.auditReason !== problems.join("; "))
    failures.push(`${artifact.id}: stale-audit-findings`);

  return failures;
};

const checkArtifact = (artifact: Artifact): ReadonlyArray<string> => {
  const failures: Array<string> = [];
  const path = join(import.meta.dir, "audits", `${artifact.id}.json`);
  const bytes = readFileSync(path);
  const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(AuditManifest))(bytes.toString());

  if (!artifact.auditRoot || !verifyIntegrity(bytes, artifact.auditRoot))
    failures.push(`${artifact.id}: audit-root`);

  if (manifest.artifactId !== artifact.id || manifest.artifactIntegrity !== artifact.integrity)
    failures.push(`${artifact.id}: manifest-identity`);

  if (artifact.audit === "verified" && manifest.coverage !== "complete")
    failures.push(`${artifact.id}: incomplete-coverage`);

  if (artifact.audit === "pending" && !artifact.auditReason)
    failures.push(`${artifact.id}: missing-block-reason`);

  return [
    ...failures,
    ...checkFiles(manifest.evidence ?? []),
    ...checkFiles(manifest.notices),
    ...checkNpm(artifact, manifest),
  ];
};

export const checkCatalog = (): ReadonlyArray<string> => {
  const toolIds = catalog.tools.map((tool) => tool.id);
  const failures = catalog.tools.flatMap((tool) => tool.artifacts.flatMap(checkArtifact));

  if (new Set(toolIds).size !== toolIds.length) failures.push("duplicate-tool-id");

  for (const tool of catalog.tools)
    if (tool.artifacts.length === 0) failures.push(`${tool.id}: missing-artifacts`);

  for (const integration of catalog.integrations) {
    for (const provider of integration.providers)
      if (!toolIds.includes(provider.tool)) failures.push(`${integration.id}: unknown-provider`);
  }

  return failures;
};

if (import.meta.main) {
  const failures = checkCatalog();

  const blocked = catalog.tools.filter((tool) =>
    tool.artifacts.some((artifact) => artifact.audit === "pending")
  );

  for (const failure of failures) console.error(failure);

  console.log(
    `Catalog consistency: ${failures.length} failures; ${catalog.integrations.length} integrations, ${catalog.tools.length} pinned tools; ${blocked.length} tools have explicit activation audit blocks.`
  );

  if (process.argv.includes("--release")) {
    for (const tool of blocked) console.error(`${tool.id}: ${tool.artifacts[0]?.auditReason}`);
  }

  process.exitCode =
    failures.length > 0 || (process.argv.includes("--release") && blocked.length > 0) ? 1 : 0;
}

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Schema } from "effect";
import { catalog } from "../../apps/daemon/src/languages/catalog";
import type { Artifact } from "../../apps/daemon/src/languages/catalog/model";
import {
  AuditManifest,
  safeArchivePath,
  verifyIntegrity,
} from "../../apps/daemon/src/languages/catalog/verification";

interface DeliveryInput {
  readonly artifact: Artifact;
  readonly sourceRoot: string;
  readonly destination: string;
}

/** Stage exact notices for review; pending audit and delivery never become installation readiness. */
export const deliverNotices = ({
  artifact,
  sourceRoot,
  destination,
}: DeliveryInput): ReadonlyArray<string> => {
  const bytes = readFileSync(join(sourceRoot, "audits", `${artifact.id}.json`));

  if (!artifact.auditRoot || !verifyIntegrity(bytes, artifact.auditRoot))
    throw new Error("notice-delivery-audit-root");

  const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(AuditManifest))(bytes.toString());

  if (
    manifest.artifactId !== artifact.id ||
    manifest.artifactIntegrity !== artifact.integrity ||
    !manifest.notices.length
  )
    throw new Error("notice-delivery-artifact-scope");

  const files = manifest.notices.map((reference) => {
    if (!safeArchivePath(reference.path)) throw new Error("notice-delivery-path");

    const content = readFileSync(join(sourceRoot, reference.path));

    if (!verifyIntegrity(content, reference.integrity))
      throw new Error("notice-delivery-integrity");

    return { ...reference, content };
  });

  const parent = realpathSync(dirname(resolve(destination)));

  const temporary = realpathSync("/tmp");

  if (parent !== temporary && !parent.startsWith(`${temporary}/`))
    throw new Error("notice-delivery-private-root");

  const target = join(parent, resolve(destination).split("/").at(-1)!);

  mkdirSync(target);

  for (const file of files) {
    const path = join(target, file.path);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content);
  }

  writeFileSync(join(target, "audit-manifest.json"), bytes);
  writeFileSync(
    join(target, "delivery.json"),
    `${JSON.stringify(
      {
        artifactId: artifact.id,
        artifactIntegrity: artifact.integrity,
        auditRoot: artifact.auditRoot,
        audit: artifact.audit,
        auditReason: artifact.auditReason,
        notices: manifest.notices,
        status: "notice-evidence-staged; no installation or activation approval",
      },
      null,
      2
    )}\n`
  );

  return files.map((file) => file.path);
};

if (import.meta.main) {
  const artifactId = process.argv[2];

  const destination = process.argv[3];

  const artifact = catalog.tools
    .filter((tool) => tool.disposition === "offered")
    .flatMap((tool) => tool.artifacts)
    .find((candidate) => candidate.id === artifactId);

  if (!artifact || !destination)
    throw new Error("Expected offered artifact ID and fresh private destination");

  console.log(
    `${deliverNotices({ artifact, sourceRoot: import.meta.dir, destination }).length} exact notices staged; artifact audit remains ${artifact.audit}.`
  );
}

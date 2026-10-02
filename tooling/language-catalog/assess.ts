import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { Catalog } from "../../apps/daemon/src/languages/catalog/model";
import { auditBundle, readBundle } from "./audit";

const root = import.meta.dir;

const catalogPath = join(root, "../../apps/daemon/src/languages/catalog/catalog.json");

const data = Schema.decodeUnknownSync(Schema.fromJsonString(Catalog))(
  readFileSync(catalogPath, "utf8")
);

const supplements = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        sha256: Schema.optional(Schema.String),
        path: Schema.optional(Schema.String),
        source: Schema.optional(Schema.String),
        failure: Schema.optional(Schema.String),
      })
    )
  )
)(readFileSync(join(root, "notice-supplements.json"), "utf8"));

const manifests = join(root, "audits");

mkdirSync(manifests, { recursive: true });

const hash = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const findingsByTool = new Map<string, ReadonlyArray<string>>();

for (const file of readdirSync(join(root, "bundles"))) {
  const path = join(root, "bundles", file);
  const bundle = readBundle(path);
  findingsByTool.set(bundle.name, auditBundle({ bundle, noticeRoot: join(root, "notices") }));
}

const nativeEvidence = new Map<string, ReadonlyArray<string>>([
  ["ruff", ["ruff-crates.json", "source-notices.json"]],
  ["rust-analyzer", ["rust-analyzer-crates.json", "source-notices.json"]],
  ["lua-language-server", ["lua-notices.json", "lua-source-inventory.json"]],
  ["phpactor", ["phpactor-phar.json", "php-composer.lock.json", "source-notices.json"]],
  ["jdtls", ["jdtls-bundles.json", "external-audits.json"]],
  ["shellcheck", ["source-notices.json", "external-audits.json"]],
  ["shfmt", ["source-notices.json"]],
  ["gopls", ["gopls-modules.json", "gopls-go.sum"]],
]);

const sourceNotices = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Struct({ sha256: Schema.String })))
)(readFileSync(join(root, "source-notices.json"), "utf8"));

const tools = data.tools.map((tool) => ({
  ...tool,
  artifacts: tool.artifacts.map((artifact) => {
    const findings = artifact.bundle
      ? (findingsByTool.get(artifact.bundle) ?? ["missing-bundle"])
      : [artifact.auditReason];

    const notices = artifact.bundle
      ? readBundle(join(root, "bundles", `${artifact.bundle}.json`)).packages.flatMap((pkg) =>
          pkg.notices.map((notice) => ({
            path: `notices/${notice.sha256}.txt`,
            integrity: `sha256:${notice.sha256}`,
          }))
        )
      : Object.entries(sourceNotices)
          .filter(([name]) => name === tool.id || name.startsWith(`${tool.id}-`))
          .filter(([name]) => !name.endsWith("source"))
          .map(([, notice]) => ({
            path: `notices/${notice.sha256}.txt`,
            integrity: `sha256:${notice.sha256}`,
          }));

    const unique = Array.from(new Map(notices.map((notice) => [notice.path, notice])).values());

    const manifest = {
      artifactId: artifact.id,
      artifactIntegrity: artifact.integrity,
      coverage: findings.length === 0 ? "complete" : "pending",
      notices: unique,
      findings,
      bundleIntegrity: artifact.bundle
        ? hash(readFileSync(join(root, "bundles", `${artifact.bundle}.json`)))
        : null,
      supplements: Object.keys(supplements),
      evidence: (nativeEvidence.get(tool.id) ?? []).map((path) => ({
        path,
        integrity: hash(readFileSync(join(root, path))),
      })),
    };

    const manifestPath = join(manifests, `${artifact.id}.json`);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    execFileSync(join(root, "../../node_modules/.bin/oxfmt"), [manifestPath]);
    const bytes = readFileSync(manifestPath);

    return {
      ...artifact,
      auditRoot: hash(bytes),
      audit: findings.length === 0 ? "verified" : "pending",
      auditReason: findings.join("; "),
    };
  }),
}));

writeFileSync(catalogPath, `${JSON.stringify({ ...data, tools }, null, 2)}\n`);

execFileSync(join(root, "../../node_modules/.bin/oxfmt"), [catalogPath]);

console.log(
  `${data.tools.length} tools assessed; ${Array.from(findingsByTool.values()).filter((findings) => findings.length === 0).length} npm bundles eligible.`
);

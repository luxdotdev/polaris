import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { isAllowed } from "../../scripts/licenses";
import {
  safeArchivePath,
  verifyIntegrity,
} from "../../apps/daemon/src/languages/catalog/verification";

export const PackageAudit = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  license: Schema.String,
  integrity: Schema.String,
  url: Schema.String,
  location: Schema.String,
  verifiedBytes: Schema.Number,
  notices: Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String })),
});

export type PackageAudit = typeof PackageAudit.Type;

const LockedPackage = Schema.Struct({
  version: Schema.optional(Schema.String),
  resolved: Schema.optional(Schema.String),
  integrity: Schema.optional(Schema.String),
});

export const Bundle = Schema.Struct({
  name: Schema.String,
  manifest: Schema.Struct({
    name: Schema.String,
    version: Schema.String,
    private: Schema.Literal(true),
    dependencies: Schema.Record(Schema.String, Schema.String),
    overrides: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
  lock: Schema.Struct({
    lockfileVersion: Schema.Literal(3),
    packages: Schema.Record(Schema.String, LockedPackage),
  }),
  packages: Schema.Array(PackageAudit),
});

export type Bundle = typeof Bundle.Type;

export interface BundleInput {
  readonly bundle: Bundle;
  readonly noticeRoot: string;
}

const packageProblems = (pkg: PackageAudit, noticeRoot: string): ReadonlyArray<string> => {
  const problems: Array<string> = [];
  const identity = `${pkg.name}@${pkg.version}`;

  if (!isAllowed(pkg.license)) problems.push(`${identity}: license-review:${pkg.license}`);

  if (!pkg.url.startsWith("https://registry.npmjs.org/")) problems.push(`${identity}: origin`);

  if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity) || pkg.verifiedBytes <= 0)
    problems.push(`${identity}: unverified-package`);

  if (pkg.notices.length === 0) problems.push(`${identity}: notice-coverage`);

  for (const notice of pkg.notices) {
    if (!safeArchivePath(notice.path) || !/^[a-f0-9]{64}$/.test(notice.sha256)) {
      problems.push(`${identity}: unsafe-notice`);
      continue;
    }

    try {
      const bytes = readFileSync(join(noticeRoot, `${notice.sha256}.txt`));

      if (!verifyIntegrity(bytes, `sha256:${notice.sha256}`))
        problems.push(`${identity}: notice-integrity:${notice.path}`);
    } catch {
      problems.push(`${identity}: notice-missing:${notice.path}`);
    }
  }

  return problems;
};

/** Check the entire frozen lock, including optional and non-Host platform dependencies. */
export const auditBundle = ({ bundle, noticeRoot }: BundleInput): ReadonlyArray<string> => {
  const problems = bundle.packages.flatMap((pkg) => packageProblems(pkg, noticeRoot));
  const lockEntries = Object.entries(bundle.lock.packages).filter(([path]) => path !== "");

  if (new Set(bundle.packages.map((pkg) => pkg.location)).size !== bundle.packages.length)
    problems.push(`${bundle.name}: duplicate-package-location`);

  if (lockEntries.length !== bundle.packages.length) problems.push(`${bundle.name}: closure-size`);

  for (const [location, locked] of lockEntries) {
    const pkg = bundle.packages.find((candidate) => candidate.location === location);

    if (
      !safeArchivePath(location) ||
      !pkg ||
      pkg.version !== locked.version ||
      pkg.url !== locked.resolved ||
      pkg.integrity !== locked.integrity
    )
      problems.push(`${bundle.name}: closure-integrity:${location}`);
  }

  for (const [name, version] of Object.entries(bundle.manifest.dependencies)) {
    const root = bundle.packages.find((pkg) => pkg.location === `node_modules/${name}`);

    if (!root || root.version !== version) problems.push(`${bundle.name}: root-pin:${name}`);
  }

  return problems;
};

export const readBundle = (path: string): Bundle =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Bundle))(readFileSync(path, "utf8"));

const main = (): void => {
  const dir = join(import.meta.dir, "bundles");

  const failures = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) =>
      auditBundle({
        bundle: readBundle(join(dir, name)),
        noticeRoot: join(import.meta.dir, "notices"),
      })
    );

  for (const failure of failures) console.error(failure);

  console.log(
    `Managed npm audit: ${failures.length} unresolved findings; all frozen dependencies checked.`
  );
  process.exitCode = failures.length > 0 ? 1 : 0;
};

if (import.meta.main) main();

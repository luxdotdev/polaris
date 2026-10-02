import { createHash } from "node:crypto";
import { Schema } from "effect";
import { RelativeManifestPath, type Artifact } from "./model";
import { safeArchivePath, verifyIntegrity } from "./verification";

export const PackagedFile = Schema.Struct({
  path: RelativeManifestPath,
  integrity: Schema.String,
  size: Schema.Number,
  mode: Schema.Number,
});

export type PackagedFile = typeof PackagedFile.Type;

export const PackagingManifest = Schema.Struct({
  filter: Schema.Literal("lua-core-v1"),
  sourceIntegrity: Schema.String,
  postFilterIntegrity: Schema.String,
  files: Schema.Array(PackagedFile),
});

/** Check the pinned packaging record without granting legal or activation approval. */
export const packagingManifestFailures = (
  artifact: Artifact,
  bytes: Uint8Array
): ReadonlyArray<string> => {
  const descriptor = artifact.packaging;

  if (
    !descriptor ||
    descriptor.sourceIntegrity !== artifact.integrity ||
    !verifyIntegrity(bytes, descriptor.manifestIntegrity)
  )
    return ["packaging-manifest-integrity"];

  try {
    const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(PackagingManifest))(
      Buffer.from(bytes).toString("utf8")
    );

    if (
      manifest.sourceIntegrity !== artifact.integrity ||
      manifest.postFilterIntegrity !== descriptor.postFilterIntegrity ||
      packagedRoot(manifest.files) !== descriptor.postFilterIntegrity
    )
      return ["packaging-output-integrity"];

    const paths = manifest.files.map((file) => file.path);

    return new Set(paths).size !== paths.length ||
      paths.some((path) => path.startsWith("meta/3rd/")) ||
      !paths.includes("LICENSE") ||
      !paths.some((path) => path.startsWith("meta/template/"))
      ? ["packaging-manifest-coverage"]
      : [];
  } catch {
    return ["packaging-manifest-invalid"];
  }
};

export interface ArchiveEntry {
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink" | "hardlink";
  readonly mode: number;
  readonly bytes: Uint8Array;
}

const hash = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Hash only sorted file identities and modes; archive timestamps and owner IDs are irrelevant. */
export const packagedRoot = (files: ReadonlyArray<PackagedFile>): string =>
  hash(
    Buffer.from(
      JSON.stringify(
        files.map(({ path, integrity, size, mode }) => ({
          path,
          integrity,
          size,
          mode,
        }))
      )
    )
  );

/** Validate every entry before filtering, including links hidden in the excluded annotation tree. */
export const packagedFiles = (
  entries: ReadonlyArray<ArchiveEntry>
): ReadonlyArray<PackagedFile> => {
  const files: PackagedFile[] = [];
  const paths = new Set<string>();

  for (const entry of entries) {
    if (!safeArchivePath(entry.path) || entry.path.startsWith("./"))
      throw new Error(`unsafe-packaging-path:${entry.path}`);

    if (entry.kind === "symlink" || entry.kind === "hardlink")
      throw new Error(`packaging-link:${entry.path}`);

    if (paths.has(entry.path)) throw new Error(`duplicate-packaging-path:${entry.path}`);

    paths.add(entry.path);

    if (
      entry.kind === "directory" ||
      entry.path === "meta/3rd" ||
      entry.path.startsWith("meta/3rd/")
    )
      continue;

    files.push(
      PackagedFile.make({
        path: entry.path,
        integrity: hash(entry.bytes),
        size: entry.bytes.length,
        mode: entry.mode,
      })
    );
  }

  return files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
};

export interface PackagingInput {
  readonly artifact: Artifact;
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
  readonly entries: ReadonlyArray<ArchiveEntry>;
  readonly installedEntries: ReadonlyArray<ArchiveEntry>;
  readonly thirdPartyDiscovery: boolean;
}

/** Installers must enforce this contract before staging the filtered distribution as installed. */
export const verifyPackaging = (input: PackagingInput): ReadonlyArray<string> => {
  const descriptor = input.artifact.packaging;

  if (!descriptor) return ["packaging-descriptor-missing"];

  if (
    descriptor.sourceIntegrity !== input.artifact.integrity ||
    !verifyIntegrity(input.sourceBytes, input.artifact.integrity)
  )
    return ["packaging-source-integrity"];

  if (
    !safeArchivePath(descriptor.manifest) ||
    !verifyIntegrity(input.manifestBytes, descriptor.manifestIntegrity)
  )
    return ["packaging-manifest-integrity"];

  try {
    const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(PackagingManifest))(
      Buffer.from(input.manifestBytes).toString("utf8")
    );

    const actual = packagedFiles(input.entries);

    const installed = packagedFiles(input.installedEntries);

    const failures: string[] = [];

    if (
      manifest.sourceIntegrity !== descriptor.sourceIntegrity ||
      manifest.postFilterIntegrity !== descriptor.postFilterIntegrity ||
      packagedRoot(manifest.files) !== descriptor.postFilterIntegrity ||
      packagedRoot(actual) !== descriptor.postFilterIntegrity ||
      packagedRoot(installed) !== descriptor.postFilterIntegrity
    )
      failures.push("packaging-output-integrity");

    if (
      input.installedEntries.some(
        (entry) => entry.path === "meta/3rd" || entry.path.startsWith("meta/3rd/")
      )
    )
      failures.push("packaging-excluded-entry-present");

    if (
      !actual.some((file) => file.path.startsWith("meta/template/")) ||
      !actual.some((file) => file.path === "LICENSE")
    )
      failures.push("packaging-core-omission");

    if (input.thirdPartyDiscovery) failures.push("packaging-third-party-discovery");

    return failures;
  } catch {
    return ["packaging-input-invalid"];
  }
};

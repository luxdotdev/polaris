import { Schema } from "effect";
import type { ArchiveEntry } from "../catalog/packaging.ts";
import { RelativeManifestPath } from "../catalog/model.ts";
import { gunzip, tarEntries } from "./archive.ts";
import { httpsArtifactDownload } from "./download.ts";
import { upstreamRuntimeLimits, type ExactArtifact } from "./types.ts";
import { checkAbort, failure, verifyIntegrity } from "./validation.ts";

const Dependencies = Schema.Struct({
  root: Schema.String,
  packages: Schema.Array(
    Schema.Struct({
      location: RelativeManifestPath,
      name: Schema.String,
      version: Schema.String,
      url: Schema.String,
      integrity: Schema.String,
      registryIntegrity: Schema.String,
      license: Schema.NullOr(Schema.String),
    })
  ).check(Schema.isMaxLength(128)),
});

type Dependency = (typeof Dependencies.Type.packages)[number];

async function dependencyArchive(
  pin: Dependency,
  exact: ExactArtifact,
  signal: AbortSignal,
  download: ReturnType<typeof httpsArtifactDownload>
) {
  const url = new URL(pin.url);

  if (url.hostname !== "registry.npmjs.org" || !pin.location.startsWith("node_modules/"))
    throw failure("audit-required", "Dependency is outside the frozen npm registry");

  const chunks: Uint8Array[] = [];
  let size = 0;

  for await (const chunk of download(
    { ...exact, artifact: { ...exact.artifact, url: pin.url } },
    signal
  )) {
    size += chunk.length;

    if (size > upstreamRuntimeLimits.downloadBytes)
      throw failure("too-large", "Dependency download exceeds the runtime budget");

    chunks.push(chunk);
  }

  const bytes = Buffer.concat(chunks);

  if (!verifyIntegrity(bytes, pin.integrity) || !verifyIntegrity(bytes, pin.registryIntegrity))
    throw failure("audit-required", "Frozen dependency checksum does not match");

  return { size, archive: await gunzip(bytes, signal, upstreamRuntimeLimits.expandedBytes) };
}

function dependencyEntries(archive: Uint8Array, pin: Dependency, signal: AbortSignal) {
  const entries = tarEntries(archive, signal, upstreamRuntimeLimits, undefined, { npm: true });
  const typesRoot = pin.name.startsWith("@types/") ? pin.name.slice(7) : "package";
  const firstPath = entries[0]?.path;

  const root =
    firstPath === typesRoot || firstPath?.startsWith(`${typesRoot}/`) ? typesRoot : "package";

  return entries
    .filter((entry) => entry.path !== root)
    .map((entry) => {
      if (!entry.path.startsWith(`${root}/`))
        throw failure("install-failed", "Dependency archive has an unexpected root");

      return { ...entry, path: `${pin.location}/${entry.path.slice(root.length + 1)}` };
    });
}

/** Frozen npm locations preserve nested versions; no npm process, resolution or install scripts. */
export async function webDependencies(
  input: typeof Schema.Json.Type,
  exact: ExactArtifact,
  signal: AbortSignal,
  download = httpsArtifactDownload(fetch, upstreamRuntimeLimits.downloadBytes)
): Promise<ArchiveEntry[]> {
  const dependencies = Schema.decodeUnknownSync(Dependencies)(input);
  const entries: ArchiveEntry[] = [];
  let totalBytes = 0;
  let expandedBytes = 0;

  for (const pin of dependencies.packages) {
    checkAbort(signal);

    if (pin.location === `node_modules/${dependencies.root}`) continue;
    const { size, archive } = await dependencyArchive(pin, exact, signal, download);
    totalBytes += size;

    if (totalBytes > upstreamRuntimeLimits.downloadBytes)
      throw failure("too-large", "Dependency downloads exceed the runtime budget");
    expandedBytes += archive.length;

    if (expandedBytes > upstreamRuntimeLimits.expandedBytes)
      throw failure("too-large", "Dependencies exceed the expanded runtime budget");
    entries.push(...dependencyEntries(archive, pin, signal));

    if (entries.length > upstreamRuntimeLimits.entries)
      throw failure("too-large", "Dependencies exceed the runtime entry budget");
  }

  return entries;
}

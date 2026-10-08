import { Schema } from "effect";
import type { ArchiveEntry } from "../catalog/packaging.ts";
import type { ExactArtifact } from "./types.ts";
import { upstreamRuntimeLimits } from "./types.ts";
import { checkAbort, failure, safePath, verifyIntegrity } from "./validation.ts";
import { httpsArtifactDownload } from "./download.ts";
import { gunzip, tarEntries } from "./archive.ts";
import packages from "../catalog/upstream-evidence/sql-shell-dependencies.json";

const Dependencies = Schema.Record(
  Schema.String,
  Schema.Array(
    Schema.Struct({
      location: Schema.String,
      url: Schema.String,
      integrity: Schema.String,
    })
  )
);

const pins = Schema.decodeUnknownSync(Dependencies)(packages);

/** Extract only frozen upstream dependency releases; no resolver, scripts, npm or builds on the Host. */
export async function npmDependencies(
  exact: ExactArtifact,
  signal: AbortSignal
): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  let downloaded = 0;
  let expanded = 0;

  for (const pin of pins[exact.tool.id] ?? []) {
    checkAbort(signal);

    if (
      !safePath(pin.location) ||
      !pin.location.startsWith("node_modules/") ||
      !pin.url.startsWith("https://registry.npmjs.org/")
    )
      throw failure("audit-required", "Invalid frozen dependency");
    const chunks: Uint8Array[] = [];
    let size = 0;

    for await (const chunk of httpsArtifactDownload(fetch, upstreamRuntimeLimits.downloadBytes)(
      { ...exact, artifact: { ...exact.artifact, url: pin.url } },
      signal
    )) {
      size += chunk.length;
      downloaded += chunk.length;

      if (downloaded > upstreamRuntimeLimits.downloadBytes)
        throw failure("too-large", "Dependency download limit exceeded");
      chunks.push(chunk);
    }

    const bytes = Buffer.concat(chunks, size);

    if (!verifyIntegrity(bytes, pin.integrity))
      throw failure("audit-required", "Dependency checksum changed");
    const archive = await gunzip(bytes, signal, upstreamRuntimeLimits.expandedBytes - expanded);
    expanded += archive.length;

    entries.push(...dependencyEntries(archive, pin.location, signal));

    if (entries.length > upstreamRuntimeLimits.entries)
      throw failure("too-large", "Dependency entry limit exceeded");
  }

  return entries;
}

function dependencyEntries(
  archive: Uint8Array,
  location: string,
  signal: AbortSignal
): ArchiveEntry[] {
  return tarEntries(archive, signal, upstreamRuntimeLimits)
    .filter((entry) => entry.path !== "package")
    .map((entry) => {
      if (!entry.path.startsWith("package/"))
        throw failure("install-failed", "Unexpected dependency archive root");

      return { ...entry, path: location + "/" + entry.path.slice(8) };
    });
}

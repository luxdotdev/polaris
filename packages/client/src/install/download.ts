/**
 * The fallback when a Host can't download its Daemon itself: this machine
 * downloads the Release archive into a cache (`<cacheDir>/<version>/<platform>/`),
 * checks it and every file against the bundled manifest, and the build is then
 * uploaded like a bundled one. Other versions in the cache are removed.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { unpackArchive } from "./archive.ts";
import { archiveRequestUrl, type DaemonBuild } from "./builds.ts";
import { type DownloadBuild, RemoteInstallError } from "./remote.ts";

export interface DownloadOptions {
  /** The cache root, e.g. the Desktop App's `<userData>/daemon-builds`. */
  readonly cacheDir: string;
  /** This Client's version, for the site's telemetry. */
  readonly clientVersion?: string | undefined;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** The whole download, default 10 minutes. */
  readonly timeoutMs?: number;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const located = (build: DaemonBuild, dir: string): DaemonBuild => ({
  ...build,
  bundled: true,
  files: build.files.map((file) => ({ ...file, path: join(dir, file.name) })),
});

/** Whether `dir` holds every file of `build` with its expected SHA-256. */
const cached = (build: DaemonBuild, dir: string) =>
  build.files.every((file) => {
    const path = join(dir, file.name);

    return existsSync(path) && sha256(readFileSync(path)) === file.sha256;
  });

const readBody = async (
  response: Response,
  limit: number,
  onBytes: (bytes: number) => void
): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let received = 0;

  if (response.body === null) throw new Error("the download has no body");
  const body: ReadableStream<Uint8Array> = response.body;
  const reader = body.getReader();

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;
    received += value.length;

    if (received > limit) throw new Error(`the download is larger than ${limit} bytes`);
    chunks.push(value);
    onBytes(received);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
};

/** Writes the archive's files for `build` into `dir`, checking each against the manifest. */
const install = (build: DaemonBuild, archive: Uint8Array, dir: string) => {
  const entries = new Map(unpackArchive(archive).map((entry) => [entry.name, entry]));
  const staging = `${dir}.part-${randomBytes(4).toString("hex")}`;
  mkdirSync(staging, { recursive: true });

  try {
    for (const file of build.files) {
      const entry = entries.get(file.name);

      if (entry === undefined) throw new Error(`the archive lacks ${file.name}`);

      if (sha256(entry.bytes) !== file.sha256)
        throw new Error(`${file.name} in the archive differs from this app's manifest`);
      writeFileSync(join(staging, file.name), entry.bytes);
      chmodSync(join(staging, file.name), file.executable ? 0o755 : 0o644);
    }

    rmSync(dir, { recursive: true, force: true });
    renameSync(staging, dir);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
};

const prune = (cacheDir: string, keep: string) => {
  for (const name of readdirSync(cacheDir))
    if (name !== keep) rmSync(join(cacheDir, name), { recursive: true, force: true });
};

/** A `DownloadBuild` for `applyPlan`: downloads, verifies and caches a build that isn't bundled. */
export const downloadBuild =
  (options: DownloadOptions): DownloadBuild =>
  (build, onBytes) => {
    const fail = (message: string) =>
      new RemoteInstallError({ alias: "this machine", step: "download", message });

    const archive = build.archive;

    if (archive === null)
      return Effect.fail(fail(`no ${build.platform} daemon is published for ${build.version}`));
    const dir = join(options.cacheDir, build.version, build.platform);

    return Effect.tryPromise({
      try: async (signal) => {
        if (cached(build, dir)) return located(build, dir);

        const url = archiveRequestUrl(archive, "client", options.clientVersion);

        const response = await (options.fetch ?? fetch)(url, {
          redirect: "follow",
          signal: AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 600_000)]),
        });

        if (!response.ok) throw new Error(`${archive.name}: HTTP ${response.status}`);
        const bytes = await readBody(response, archive.size, onBytes);

        if (bytes.length !== archive.size || sha256(bytes) !== archive.sha256)
          throw new Error(`${archive.name} differs from this app's manifest (SHA-256)`);
        install(build, bytes, dir);
        prune(options.cacheDir, build.version);

        return located(build, dir);
      },
      catch: (cause) => fail(cause instanceof Error ? cause.message : String(cause)),
    });
  };

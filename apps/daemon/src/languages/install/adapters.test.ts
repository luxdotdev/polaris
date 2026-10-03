import { rejects } from "node:assert/strict";
import { test, expect } from "bun:test";
import { gzipSync } from "node:zlib";
import { mkdtemp, mkdir, realpath, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactFixture, hostId, platform } from "./fixture.testing.ts";
import { artifactIdentity } from "./identity.ts";
import { digest, verifyPayload } from "./validation.ts";
import { defaultLimits, descriptor, type ExactArtifact } from "./types.ts";
import { httpsArtifactDownload } from "./download.ts";
import { artifactDecoder } from "./decode.ts";
import { packagedEvidenceReader } from "./evidence.ts";
import { gunzip, tarEntries } from "./archive.ts";

function exactFixture(format: "binary" | "tar.gz" = "binary") {
  const source = artifactFixture();
  source.tool.artifacts[0]!.format = format;
  const parsed = descriptor(source.tool, defaultLimits.metadataBytes);
  const artifact = parsed.tool.artifacts[0]!;

  const exact: ExactArtifact = {
    hostId,
    platform,
    tool: parsed.tool,
    descriptor: parsed.raw,
    artifact,
    identity: artifactIdentity({ hostId, platform, descriptor: source.tool, artifact }),
  };

  return { ...source, exact };
}

function tar(path = "bin/tool", type = "0", content = Buffer.from("synthetic")) {
  const header = Buffer.alloc(512);
  header.write(path, 0, 100);
  header.write("0000755\0", 100);
  header.write(content.length.toString(8).padStart(11, "0") + "\0", 124);
  header.fill(32, 148, 156);
  header.write(type, 156);
  header.write("ustar\0", 257);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);

  return Buffer.concat([
    header,
    content,
    Buffer.alloc(Math.ceil(content.length / 512) * 512 - content.length),
    Buffer.alloc(1024),
  ]);
}

test("Host HTTPS download preserves bytes, requires exact URL and cancels its body on limits", async () => {
  const f = exactFixture();
  let init: RequestInit | undefined;

  const download = httpsArtifactDownload(async (_url, options) => {
    init = options;

    return new Response(f.bytes, { headers: { "content-length": String(f.bytes.length) } });
  });

  const result: Uint8Array[] = [];

  for await (const bytes of download(f.exact, new AbortController().signal)) result.push(bytes);
  expect(Buffer.concat(result)).toEqual(f.bytes);
  expect(init).toMatchObject({ redirect: "manual", credentials: "omit" });
  expect(init?.signal?.aborted).toBe(true);
  let cancelled = false;

  const oversized = httpsArtifactDownload(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-length": String(defaultLimits.downloadBytes + 1) } }
      )
  );

  await rejects(Array.fromAsync(oversized(f.exact, new AbortController().signal)), {
    reason: "too-large",
  });
  expect(cancelled).toBe(true);
  const redirect = httpsArtifactDownload(async () => new Response(null, { status: 302 }));
  await rejects(Array.fromAsync(redirect(f.exact, new AbortController().signal)), {
    reason: "install-failed",
  });
  const unsafe = { ...f.exact, artifact: { ...f.exact.artifact, url: "http://invalid.example" } };
  await rejects(Array.fromAsync(download(unsafe, new AbortController().signal)), {
    reason: "audit-required",
  });
});

test("strict archive decoding rejects links, traversal, truncation, corrupt headers and gzip expansion", async () => {
  const signal = new AbortController().signal;
  expect(tarEntries(tar(), signal)[0]).toMatchObject({
    path: "bin/tool",
    mode: 0o755,
    kind: "file",
  });
  expect(() => tarEntries(tar("../escape"), signal)).toThrow("Unsafe archive path");

  for (const type of ["1", "2", "x", "g", "L", "3"])
    expect(() => tarEntries(tar("link", type), signal)).toThrow("not permitted");
  expect(() => tarEntries(tar().subarray(0, 800), signal)).toThrow("truncated");
  const corrupt = tar();
  corrupt[0] = 0;
  expect(() => tarEntries(corrupt, signal)).toThrow("checksum");
  expect(await gunzip(gzipSync(Buffer.from("synthetic")), signal, 16)).toEqual(
    Buffer.from("synthetic")
  );
  await rejects(gunzip(gzipSync(Buffer.alloc(4096)), signal, 32), {
    reason: "too-large",
  });
  await rejects(gunzip(Buffer.from("corrupt"), signal, 32));
  const aborted = new AbortController();
  aborted.abort();
  await rejects(gunzip(gzipSync(Buffer.alloc(1)), aborted.signal, 32), {
    reason: "cancelled",
  });
});

test("verified packaged evidence and pure binary decoder retain exact notices and reject tampering/links", async () => {
  const f = exactFixture();
  const root = await realpath(await mkdtemp(join(tmpdir(), "m31-i1-evidence-")));
  const signal = new AbortController().signal;

  try {
    await mkdir(join(root, "audits"));
    await writeFile(join(root, "audits/fake.json"), f.payload.manifestBytes);
    await writeFile(join(root, "LICENSE"), f.payload.entries[1]!.bytes);
    const reader = await packagedEvidenceReader(root);
    const decode = artifactDecoder(reader);
    const payload = await decode(f.bytes, f.exact, signal);
    expect(
      verifyPayload(f.bytes, payload, f.exact, defaultLimits).map((entry) => entry.path)
    ).toEqual(["bin/tool", "LICENSE"]);
    await writeFile(join(root, "LICENSE"), "corrupt");
    await rejects(decode(f.bytes, f.exact, signal), {
      reason: "audit-required",
    });
    await rm(join(root, "LICENSE"));
    await symlink("audits/fake.json", join(root, "LICENSE"));
    await rejects(reader(f.exact, signal));
    await rejects(decode(Buffer.from("tampered"), f.exact, signal), {
      reason: "audit-required",
    });
    await rejects(
      decode(
        f.bytes,
        { ...f.exact, artifact: { ...f.exact.artifact, bundle: "pinned-but-not-adapted" } },
        signal
      ),
      { reason: "audit-required" }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tar.gz decoder verifies checksum before parsing and matches pinned archive notice bytes", async () => {
  const f = exactFixture("tar.gz");
  const bytes = gzipSync(tar());

  const manifestBytes = Buffer.from(
    JSON.stringify({
      artifactId: "fake",
      artifactIntegrity: digest(bytes),
      coverage: "complete",
      notices: [{ path: "LICENSE", integrity: digest(f.payload.entries[1]!.bytes) }],
    })
  );

  const artifact = {
    ...f.exact.artifact,
    integrity: digest(bytes),
    auditRoot: digest(manifestBytes),
  };

  const exact = { ...f.exact, artifact };
  const decode = artifactDecoder(async () => ({ manifestBytes, notices: [f.payload.entries[1]!] }));
  const payload = await decode(bytes, exact, new AbortController().signal);
  expect(verifyPayload(bytes, payload, exact, defaultLimits)).toHaveLength(2);
});

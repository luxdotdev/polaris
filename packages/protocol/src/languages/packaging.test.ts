import { expect, test } from "bun:test";
import { Schema } from "effect";
import { LanguageArtifact } from "./index.ts";

const integrity = `sha256:${"a".repeat(64)}`;

const artifact = {
  id: "lua-core-test",
  format: "tar.gz",
  url: "https://example.invalid/lua.tar.gz",
  integrity,
  platforms: [{ os: "darwin", arch: "arm64", libc: "none" }],
  entry: "bin/lua-language-server",
  bundle: null,
  audit: "pending",
  auditReason: "Requires complete evidence and G1 review",
  auditRoot: null,
};

const packaging = {
  filter: "lua-core-v1",
  sourceIntegrity: integrity,
  manifest: "tooling/language-catalog/lua-core-manifest.json",
  manifestIntegrity: `sha256:${"b".repeat(64)}`,
  postFilterIntegrity: `sha256:${"c".repeat(64)}`,
  disableThirdPartyDiscovery: true,
};

test("packaging-bearing artifacts roundtrip without changing upstream integrity or pending audit", () => {
  const input = { ...artifact, packaging };

  expect<unknown>(
    Schema.encodeSync(LanguageArtifact)(Schema.decodeUnknownSync(LanguageArtifact)(input))
  ).toEqual(input);
});

test("old artifacts without optional packaging retain their exact shape", () => {
  expect<unknown>(
    Schema.encodeSync(LanguageArtifact)(Schema.decodeUnknownSync(LanguageArtifact)(artifact))
  ).toEqual(artifact);
});

test("packaging rejects malformed filter hashes and discovery policy", () => {
  for (const invalid of [
    { ...packaging, filter: "lua-core-v2" },
    { ...packaging, sourceIntegrity: "invalid" },
    { ...packaging, manifestIntegrity: "invalid" },
    { ...packaging, postFilterIntegrity: "invalid" },
    { ...packaging, disableThirdPartyDiscovery: false },
  ]) {
    expect(() =>
      Schema.decodeUnknownSync(LanguageArtifact)({ ...artifact, packaging: invalid })
    ).toThrow();
  }
});

test("packaging manifest paths cannot be absolute traversing or malformed", () => {
  for (const manifest of [
    "",
    "/tmp/manifest",
    "../manifest",
    "./manifest",
    "nested/../manifest",
    "nested/./manifest",
    "nested//manifest",
    "C:/manifest",
    "C:manifest",
    "nested\\manifest",
    "a\u0000b",
    "a".repeat(4097),
  ]) {
    expect(() =>
      Schema.decodeUnknownSync(LanguageArtifact)({
        ...artifact,
        packaging: { ...packaging, manifest },
      })
    ).toThrow();
  }
});

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Schema } from "effect";
import { catalog, preflight, selectArtifact, versionSatisfies, Artifact, Tool } from "./index";
import { auditArtifact, safeArchivePath, verifyIntegrity } from "./verification";

const platform = { os: "darwin", arch: "arm64", libc: "none" } as const;

const bytes = Buffer.from("verified artifact");

const sha256 = (input: Uint8Array): string =>
  `sha256:${createHash("sha256").update(input).digest("hex")}`;

const notice = Buffer.from("MIT license notice");

const base = Artifact.make({
  id: "fixture",
  format: "binary",
  url: "https://example.invalid/fixture-1.0.0",
  integrity: sha256(bytes),
  platforms: [platform],
  entry: "fixture",
  bundle: null,
  audit: "verified",
  auditReason: "",
  auditRoot: null,
});

const manifest = Buffer.from(
  JSON.stringify({
    artifactId: base.id,
    artifactIntegrity: base.integrity,
    coverage: "complete",
    notices: [{ path: "LICENSE", integrity: sha256(notice) }],
  })
);

const artifact = { ...base, auditRoot: sha256(manifest) };

const tool = Tool.make({
  id: "fixture",
  disposition: "offered",
  version: "1.0.0",
  source: base.url,
  license: "MIT",
  artifacts: [artifact],
  requirements: [
    {
      id: "node",
      scope: "server",
      executable: "node",
      version: ">=22.22.2",
      detail: "Host runtime",
      required: true,
    },
    {
      id: "sdk",
      scope: "project",
      executable: "sdk",
      version: "present",
      detail: "Project SDK",
      required: true,
    },
  ],
  argv: [],
  environment: {},
  limitations: [],
});

const node = { id: "node", executable: "/fake/node", version: "24.18.0" };

const auditInput = {
  artifact,
  bytes,
  manifestBytes: manifest,
  notices: [{ path: "LICENSE", integrity: sha256(notice), bytes: notice }],
};

describe("catalog release prerequisites", () => {
  test("the entire agreed catalog is represented and provider tools resolve", () => {
    expect(catalog.integrations.map((entry) => entry.id).sort()).toEqual([
      "actions",
      "bash",
      "css",
      "go",
      "html",
      "java",
      "lua",
      "php",
      "prisma",
      "python",
      "rust",
      "sql",
      "typescript",
      "yaml",
    ]);
    const tools = new Set(catalog.tools.map((entry) => entry.id));

    for (const integration of catalog.integrations)
      for (const provider of integration.providers) expect(tools.has(provider.tool)).toBe(true);
  });

  test("unsupported libc never selects a GNU artifact", () => {
    const rust = catalog.tools.find((entry) => entry.id === "rust-analyzer")!;
    expect(selectArtifact(rust, { os: "linux", arch: "arm64", libc: "musl" }).status).toBe(
      "unsupported-platform"
    );
    expect(selectArtifact(rust, { os: "linux", arch: "arm64", libc: "glibc" }).status).toBe(
      "selected"
    );
  });

  test("no Node download and no unknown or incompatible version counts as ready", () => {
    for (const version of [null, "unknown", "22.22.1", "v22.22.2-rc.1"])
      expect(
        preflight({ tool, platform, probes: [{ ...node, version }], phase: "install" }).status
      ).toBe("missing-prerequisite");

    expect(preflight({ tool, platform, probes: [node], phase: "install" }).status).toBe("eligible");
  });

  test("project SDK is a separate feature prerequisite from installing the server", () => {
    const result = preflight({ tool, platform, probes: [node], phase: "features" });
    expect(result.status).toBe("missing-prerequisite");
    expect(result.missing.map((entry) => entry.id)).toEqual(["sdk"]);
  });

  test("incomplete native audits remain blocked even with all runtimes present", () => {
    const pending = {
      ...tool,
      artifacts: [
        { ...artifact, audit: "pending", auditReason: "Missing transitive notice" } as const,
      ],
    };

    expect(preflight({ tool: pending, platform, probes: [node], phase: "install" }).status).toBe(
      "audit-required"
    );
  });

  test("runtime minima compare numerically and reject arbitrary constraints", () => {
    expect(versionSatisfies("22.22.10", ">=22.22.2")).toBe(true);
    expect(versionSatisfies("22.9.0", ">=22.22.2")).toBe(false);
    expect(versionSatisfies("24.0.0", "^22")).toBe(false);
  });

  test("SQL is offline, Python and Actions have explicit multi-provider ownership", () => {
    const sql = catalog.integrations.find((entry) => entry.id === "sql")!;
    expect(sql.policy.network).toBe("offline-only");
    expect(sql.formatter.tool).toBe("sql-formatter");
    expect(sql.providers[0]?.tool).toBe("sqllens-language-server");
    const python = catalog.integrations.find((entry) => entry.id === "python")!;
    expect(python.providers.map((entry) => entry.tool)).toEqual(["pyright", "ruff"]);
    expect(python.formatter.tool).toBe("ruff");
    const actions = catalog.integrations.find((entry) => entry.id === "actions")!;
    expect(actions.providers.map((entry) => entry.diagnostics)).toEqual([
      "yaml-structure",
      "actions-expressions",
    ]);
    expect(actions.policy.network).toBe("no-account");
  });
});

describe("artifact and notice integrity", () => {
  test("artifact bytes, manifests and retained notices all pass their independent roots", () => {
    expect(auditArtifact(auditInput)).toEqual([]);
  });

  test("corrupt download never passes", () => {
    expect(auditArtifact({ ...auditInput, bytes: Buffer.from("corrupt") })).toContain(
      "artifact-integrity"
    );
  });

  test("installer cannot omit or alter required notices by changing its supplied manifest", () => {
    expect(auditArtifact({ ...auditInput, manifestBytes: Buffer.from("{}") })).toContain(
      "audit-root-integrity"
    );
    expect(auditArtifact({ ...auditInput, notices: [] })).toContain("notice-integrity: LICENSE");
    expect(
      auditArtifact({ ...auditInput, notices: [{ ...auditInput.notices[0]!, bytes }] })
    ).toContain("notice-integrity: LICENSE");
  });

  test("empty or mismatched pinned audit never qualifies", () => {
    const empty = Buffer.from(
      JSON.stringify({
        artifactId: "other",
        artifactIntegrity: base.integrity,
        coverage: "complete",
        notices: [],
      })
    );

    const result = auditArtifact({
      ...auditInput,
      artifact: { ...artifact, auditRoot: sha256(empty) },
      manifestBytes: empty,
    });

    expect(result).toContain("audit-artifact-identity");
    expect(result).toContain("notice-coverage-incomplete");
  });

  test("npm SHA512 matches exact bytes and rejects SHA1 or malformed roots", () => {
    expect(
      verifyIntegrity(bytes, `sha512-${createHash("sha512").update(bytes).digest("base64")}`)
    ).toBe(true);
    expect(verifyIntegrity(bytes, "sha1-deadbeef")).toBe(false);
    expect(verifyIntegrity(bytes, "sha512-garbage")).toBe(false);
  });

  test("archive traversal paths are rejected before extraction", () => {
    for (const path of ["../LICENSE", "a/../../x", "/LICENSE", "C:/LICENSE", "a\\b", "x\0y", "."])
      expect(safeArchivePath(path)).toBe(false);

    expect(safeArchivePath("package/LICENSE")).toBe(true);
  });

  test("unsupported Host platforms and unsafe artifact IDs fail schema parsing", () => {
    expect(() => Schema.decodeUnknownSync(Artifact)({ ...base, id: "../escape" })).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Artifact)({ ...base, integrity: "sha1-unpinned" })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Artifact)({
        ...base,
        platforms: [{ os: "linux", arch: "x64", libc: "none" }],
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Artifact)({
        ...base,
        platforms: [{ os: "win32", arch: "x64", libc: "none" }],
      })
    ).toThrow();
  });
});

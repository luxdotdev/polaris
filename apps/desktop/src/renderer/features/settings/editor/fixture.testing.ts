/** A small catalog and availability facts for Settings → Editor tests. */
import * as P from "@polaris/protocol";
import { Schema } from "effect";

const node = (tool: string) => ({
  id: "node",
  scope: "server" as const,
  executable: "node",
  version: ">=24.18.0",
  detail: `${tool} runtime`,
  required: true,
});

const tool = (id: string, version: string, requirements: ReadonlyArray<unknown> = []) => ({
  id,
  disposition: "offered",
  version,
  source: "upstream",
  license: "MIT",
  artifacts: [],
  requirements,
  argv: [],
  environment: {},
  limitations: [],
});

const integration = (
  id: string,
  languageIds: ReadonlyArray<string>,
  providers: ReadonlyArray<readonly [string, string, string]>,
  formatter = "prettier"
) => ({
  id,
  languageIds,
  patterns: [],
  providers: providers.map(([providerId, toolId, role]) => ({
    id: providerId,
    tool: toolId,
    role,
    diagnostics: "push",
    disableFeatures: [],
    entry: null,
    argv: [],
  })),
  companions: [],
  formatter: { tool: formatter, source: "managed", mode: "cli", detail: "" },
  policy: { trust: "workspace-before-execution", network: "server-default", configuration: "" },
  limitations: [],
});

export const catalog: P.LanguageCatalog = Schema.decodeUnknownSync(P.LanguageCatalog)({
  revision: 1,
  releaseDate: "2026-10-01",
  tools: [
    tool("typescript-language-server", "6.0.1", [node("tsls")]),
    tool("vscode-langservers-extracted", "4.10.0", [node("vscode")]),
    tool("pyright", "1.1.414", [
      node("pyright"),
      {
        id: "python-interpreter",
        scope: "project",
        executable: "python",
        version: "present",
        detail: "",
        required: true,
      },
    ]),
    tool("ruff", "0.16.10"),
    tool("rust-analyzer", "2026-09-28", [
      {
        id: "cargo",
        scope: "project",
        executable: "cargo",
        version: "present",
        detail: "",
        required: true,
      },
    ]),
    tool("gopls", "0.23.0"),
    tool("prettier", "3.9.9"),
    tool("node", "24.18.0"),
    tool("typescript", "6.0.3"),
  ],
  integrations: [
    integration(
      "typescript",
      ["typescript", "typescriptreact", "javascript", "javascriptreact"],
      [["typescript-language-server", "typescript-language-server", "primary"]]
    ),
    integration("html", ["html"], [["vscode-html", "vscode-langservers-extracted", "primary"]]),
    integration("css", ["css"], [["vscode-css", "vscode-langservers-extracted", "primary"]]),
    integration(
      "python",
      ["python"],
      [
        ["pyright", "pyright", "primary"],
        ["ruff", "ruff", "lint"],
      ],
      "ruff"
    ),
    integration("rust", ["rust"], [["rust-analyzer", "rust-analyzer", "primary"]], "rust-analyzer"),
    integration("go", ["go"], [["gopls", "gopls", "primary"]], "gopls"),
  ],
});

export const HOST_ID = P.HostId.make("host-1");

type Installation = P.LanguageAvailability["installation"];

type Prerequisite = P.LanguageAvailability["prerequisites"][number];

const Installation = P.LanguageInstallation.cases;

export const availability = (
  toolId: string,
  installation: Installation,
  prerequisites: ReadonlyArray<Prerequisite> = []
): P.LanguageAvailability =>
  Schema.decodeUnknownSync(P.LanguageAvailability)({
    hostId: HOST_ID,
    toolId,
    pinnedVersion: catalog.tools.find((t) => t.id === toolId)?.version ?? "1.0.0",
    platform: { os: "darwin", arch: "arm64", libc: "none" },
    installation,
    updateCandidate: null,
    phase: "install",
    prerequisites,
    preflight: P.LanguagePreflight.cases.Eligible.make({ artifactId: null }),
    checkedAt: 1,
  });

export const INSTALLED = (version: string): Installation =>
  Installation.Installed.make({
    version,
    artifactId: "artifact",
    integrity: `sha256:${"a".repeat(64)}`,
  });

export const NOT_INSTALLED: Installation = Installation.NotInstalled.make({});

export const INSTALLING: Installation = Installation.Installing.make({
  jobId: "job-1",
  version: "1.1.414",
});

export const FAILED: Installation = Installation.Failed.make({
  jobId: "job-2",
  version: "0.23.0",
  message: "checksum mismatch",
  retainedVersion: null,
});

export const missingCargo: Prerequisite = {
  requirement: {
    id: "cargo",
    scope: "project",
    executable: "cargo",
    version: "present",
    detail: "",
    required: true,
  },
  effectiveExecutable: null,
  detectedVersion: null,
  outcome: "missing",
  reason: "not on PATH",
};

/** One of each row state: ready, not downloaded, installing, needs a prerequisite, failed. */
export const facts = (): ReadonlyArray<P.LanguageAvailability> => [
  availability("typescript-language-server", INSTALLED("6.0.1")),
  availability("vscode-langservers-extracted", NOT_INSTALLED),
  availability("pyright", INSTALLING),
  availability("ruff", NOT_INSTALLED),
  availability("rust-analyzer", NOT_INSTALLED, [missingCargo]),
  availability("gopls", FAILED),
  availability("node", INSTALLED("24.18.0")),
  availability("typescript", INSTALLED("6.0.3")),
];

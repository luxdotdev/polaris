/** A small catalog and Host state for Settings → Editor tests. */
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
  formatter = "prettier",
  offered = true
) => ({
  id,
  offered,
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
    integration("lua", ["lua"], [["lua-ls", "lua-language-server", "primary"]], "stylua", false),
  ],
});

export const HOST_ID = P.HostId.make("host-1");

type Installation = P.LanguageHostToolState["state"];

type Prerequisite = P.LanguageHostToolState["prerequisites"][number];

const State = P.LanguageHostToolStatus.cases;

export const availability = (
  toolId: string,
  state: Installation,
  prerequisites: ReadonlyArray<Prerequisite> = []
): P.LanguageHostToolState =>
  Schema.decodeUnknownSync(P.LanguageHostToolState)({
    toolId,
    pinnedVersion: catalog.tools.find((t) => t.id === toolId)?.version ?? "1.0.0",
    state,
    prerequisites,
    checkedAt: 1,
  });

export const INSTALLED = (version: string): Installation => State.Installed.make({ version });

export const NOT_INSTALLED: Installation = State.NotDownloaded.make({});

export const INSTALLING: Installation = State.Downloading.make({
  progress: {
    hostId: HOST_ID,
    toolId: "pyright",
    version: "1.1.414",
    jobId: "job-1",
    sequence: 1,
    phase: "downloading",
    downloadedBytes: 1,
    totalBytes: 2,
    message: "",
    activeVersion: null,
  },
});

export const FAILED: Installation = State.Failed.make({
  reason: "checksum mismatch",
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
  presence: "missing",
  path: null,
  version: null,
};

/** One of each row state: ready, not downloaded, installing, needs a prerequisite, failed. */
export const facts = (): ReadonlyArray<P.LanguageHostToolState> => [
  availability("typescript-language-server", INSTALLED("6.0.1")),
  availability("vscode-langservers-extracted", NOT_INSTALLED),
  availability("pyright", INSTALLING),
  availability("ruff", NOT_INSTALLED),
  availability("rust-analyzer", NOT_INSTALLED, [missingCargo]),
  availability("gopls", FAILED),
  availability("node", INSTALLED("24.18.0")),
  availability("typescript", INSTALLED("6.0.3")),
];

/** The feed's snapshot of the Host. */
export const hostState = (): P.LanguageHostState =>
  Schema.decodeUnknownSync(P.LanguageHostState)({
    hostId: HOST_ID,
    platform: { os: "darwin", arch: "arm64", libc: "none" },
    tools: facts(),
  });

/** Protocol values for the status tests: one TypeScript checkout on one Host. */
import * as P from "@polaris/protocol";
import type { TrustStatus } from "../trust/model.ts";
import type { ContextRuntime, Discovered, FileLanguage, HostTools, Runtime } from "./store.ts";
import type { StatusInput } from "./model.ts";

export const HOST = "mac-studio";

export const hostId = P.HostId.make("host-1");

export const workspaceId = P.WorkspaceId.make("ws-1");

export const checkout = P.LanguageCheckout.cases.Workspace.make({
  workspaceId,
  path: "/code/polaris",
});

export const TS = "typescript-language-server";

export const context = (generation = 1, providerId = TS): P.LanguageContextIdentity => ({
  hostId,
  clientId: "client-1",
  contextId: "editor-ctx-1",
  checkout,
  projectRoot: "/code/polaris",
  providerId,
  configurationFingerprint: "a".repeat(64),
  generation,
});

export const capabilities: P.LanguageProviderCapabilities = {
  positionEncoding: "utf-16",
  synchronization: "full",
  openClose: true,
  save: false,
  saveIncludeText: false,
  methods: [],
  completionResolve: false,
  actionResolve: false,
  executeCommands: [],
  diagnostics: "push",
  workspaceDiagnostics: false,
};

export const runtimes = {
  ready: P.LanguageRuntime.cases.Ready.make({ capabilities }),
  starting: P.LanguageRuntime.cases.Starting.make({}),
  awaitingTrust: P.LanguageRuntime.cases.AwaitingTrust.make({}),
  crashed: (stderr = "FATAL ERROR: Reached heap limit\nAllocation failed") =>
    P.LanguageRuntime.cases.Stopped.make({
      reason: "crash-budget",
      failure: { attempts: 3, stderr },
    }),
  idle: P.LanguageRuntime.cases.Stopped.make({ reason: "no-demand" }),
  failed: P.LanguageRuntime.cases.Failed.make({ message: "exit 1", attempts: 1, retryAt: 250 }),
} satisfies Record<string, Runtime | ((stderr?: string) => Runtime)>;

export const running = (runtime: Runtime, since = 0): ContextRuntime => ({
  context: context(),
  runtime,
  since,
});

export const eligible = (providerId = TS): Discovered => ({
  providerId,
  preflight: P.LanguagePreflight.cases.Eligible.make({ artifactId: null }),
  launch: null,
  prerequisites: [],
});

const PYTHON_MAC = { os: "darwin", arch: "arm64", libc: "none" } as const;

export const missingPython: Discovered = {
  providerId: "basedpyright",
  preflight: P.LanguagePreflight.cases.Blocked.make({
    reason: "missing-prerequisite",
    message: "No python3",
  }),
  launch: null,
  prerequisites: [
    {
      requirement: {
        id: "python",
        scope: "project",
        executable: "python3",
        version: ">=3.9",
        detail: "Project interpreter",
        required: true,
        installCommands: [
          { platforms: [PYTHON_MAC], label: "uv", command: "uv python install 3.13" },
          { platforms: [PYTHON_MAC], label: "Homebrew", command: "brew install python@3.13" },
          {
            platforms: [{ os: "linux", arch: "arm64", libc: "glibc" }],
            label: "Debian / Ubuntu",
            command: "sudo apt install python3 python3-venv",
          },
        ],
      },
      effectiveExecutable: null,
      detectedVersion: null,
      outcome: "missing",
      reason: "No .venv or uv environment, and no python3 on Raspberry Pi 4.",
    },
  ],
};

export const file = (patch: Partial<FileLanguage> = {}): FileLanguage => ({
  hostKey: HOST,
  path: "/code/polaris/src/a.ts",
  checkout,
  phase: "discovered",
  failure: null,
  providers: [eligible()],
  contexts: { [TS]: "editor-ctx-1" },
  ...patch,
});

export const trust = (
  decision: "undecided" | "trusted" | "declined",
  provider: "bundled" | "project",
  version: string | null = "7.0.2"
): TrustStatus =>
  P.LanguageTrustStatus.make({
    trust: P.LanguageTrust.make({
      scope: P.LanguageTrustScope.cases.Workspace.make({ hostId, workspaceId }),
      revision: 4,
      trusted: decision === "trusted",
      decision,
    }),
    wouldRun: {
      typescriptVersion: version,
      typescriptPath: null,
      native: true,
      plugins: [],
    },
    ask: false,
    provider,
  });

const PLATFORM = { os: "darwin", arch: "arm64", libc: "none" } as const;

const hostTool = (
  toolId: string,
  state: P.LanguageHostToolState["state"],
  pinnedVersion: string
): P.LanguageHostToolState => ({ toolId, pinnedVersion, state, prerequisites: [], checkedAt: 1 });

export const installedTools: HostTools = {
  platform: PLATFORM,
  tools: {
    typescript: hostTool(
      "typescript",
      P.LanguageHostToolStatus.cases.Installed.make({ version: "6.0.3" }),
      "6.0.3"
    ),
  },
};

export const downloading: HostTools = {
  platform: PLATFORM,
  tools: {
    node: hostTool(
      "node",
      P.LanguageHostToolStatus.cases.Downloading.make({
        progress: {
          hostId,
          toolId: "node",
          version: "24.18.0",
          jobId: "job-1",
          sequence: 3,
          phase: "downloading",
          downloadedBytes: 18 * 1024 * 1024,
          totalBytes: 46 * 1024 * 1024,
          message: "",
          activeVersion: null,
        },
      }),
      "24.18.0"
    ),
  },
};

export const input = (patch: Partial<StatusInput> = {}): StatusInput => ({
  language: "TypeScript",
  file: file(),
  runtimes: [running(runtimes.ready)],
  trust: null,
  tools: installedTools,
  host: "Mac Studio",
  hostInSentence: "Mac Studio",
  workspace: "polaris",
  now: 14 * 60_000,
  ...patch,
});

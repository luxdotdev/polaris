import * as P from "@polaris/protocol";
import { Match } from "effect";
import type {
  LanguageSettingsAdapter,
  LanguageSettingsSnapshot,
  LanguageScopeOption,
} from "./contracts.ts";

const hostId = P.HostId.make("fake-language-host");

const workspaceId = P.WorkspaceId.make("fake-language-workspace");

export const fixtureScopes: ReadonlyArray<LanguageScopeOption> = [
  { key: "app", label: "App defaults", scope: P.LanguageSettingsScope.cases.App.make({}) },
  {
    key: "language",
    label: "Python defaults",
    scope: P.LanguageSettingsScope.cases.Language.make({ language: "python" }),
  },
  {
    key: "host",
    label: "Host · fake Linux VM",
    scope: P.LanguageSettingsScope.cases.Host.make({ hostId }),
  },
  {
    key: "workspace",
    label: "Workspace · lucas/eng-169-research-herdr-dagrs-dag-model",
    scope: P.LanguageSettingsScope.cases.Workspace.make({ hostId, workspaceId, language: null }),
  },
  {
    key: "workspace-language",
    label: "Workspace · Python",
    scope: P.LanguageSettingsScope.cases.Workspace.make({
      hostId,
      workspaceId,
      language: "python",
    }),
  },
];

const checkout = P.LanguageCheckout.cases.Worktree.make({
  workspaceId,
  worktreeId: P.WorktreeId.make("fake-worktree"),
  path: "/fixture/nested-project",
});

const trust = P.LanguageTrust.make({
  scope: P.LanguageTrustScope.cases.Workspace.make({ hostId, workspaceId }),
  revision: 3,
  trusted: false,
});

export const effective = P.LanguageEffectiveSettings.make({
  revision: 0,
  formatOnSave: true,
  formatter: P.LanguageFormatterSelection.cases.None.make({}),
  providers: ["pyright", "ruff"],
  settings: {},
  origins: {},
});

const installation = P.LanguageInstallation.cases.Installed.make({
  version: "1.0.0",
  artifactId: "fixture-only",
  integrity: `sha256:${"a".repeat(64)}`,
});

const context = P.LanguageContextIdentity.make({
  hostId,
  clientId: "fixture-client",
  contextId: "fixture-context",
  checkout,
  projectRoot: checkout.path,
  providerId: "pyright",
  configurationFingerprint: "a".repeat(64),
  generation: 2,
});

const fixtureInstallation = (i: number) =>
  Match.value(i).pipe(
    Match.when(5, () => P.LanguageInstallation.cases.NotInstalled.make({})),
    Match.when(6, () =>
      P.LanguageInstallation.cases.Failed.make({
        jobId: "fake-failed",
        version: "2.0.0",
        message: "Offline download failed",
        retainedVersion: "1.0.0",
      })
    ),
    Match.when(7, () =>
      P.LanguageInstallation.cases.Installing.make({ jobId: "fake-install", version: "1.0.0" })
    ),
    Match.orElse(() => installation)
  );

const fixturePreflight = (i: number) =>
  Match.value(i).pipe(
    Match.when(10, () =>
      P.LanguagePreflight.cases.Blocked.make({
        reason: "audit-required",
        message: "Artifact audit is incomplete",
      })
    ),
    Match.when(9, () =>
      P.LanguagePreflight.cases.Blocked.make({
        reason: "missing-prerequisite",
        message: "Python is missing",
      })
    ),
    Match.when(11, () =>
      P.LanguagePreflight.cases.Blocked.make({
        reason: "unsupported-platform",
        message: "No artifact for this platform",
      })
    ),
    Match.orElse(() => P.LanguagePreflight.cases.Eligible.make({ artifactId: "fixture-only" }))
  );

const fixtureActions = (i: number) =>
  Match.value(i).pipe(
    Match.when(5, () => ({ install: "1.0.0" })),
    Match.when(6, () => ({ retry: "2.0.0", rollback: "1.0.0", logs: context })),
    Match.when(7, () => ({ cancel: "fake-install" })),
    Match.when(8, () => ({ update: "2.0.0", rollback: "1.0.0" })),
    Match.orElse(() => ({ restart: context, logs: context }))
  );

const fixtureTool = (i: number): LanguageSettingsSnapshot["hosts"][number]["tools"][number] => ({
  name:
    i === 0
      ? "Python and Ruff · very long provider name with nested workspace configuration"
      : "Fixture provider",
  availability: P.LanguageAvailability.make({
    hostId,
    toolId: "fixture-tool",
    pinnedVersion: "1.0.0",
    platform: { os: "linux", arch: "x64", libc: "glibc" },
    installation: fixtureInstallation(i),
    updateCandidate: i === 8 ? "2.0.0" : null,
    phase: "feature",
    prerequisites:
      i === 9
        ? [
            {
              requirement: {
                id: "python",
                scope: "project",
                executable: "python",
                version: ">=3.10",
                detail: "Developer-owned Python",
                required: true,
              },
              effectiveExecutable: null,
              detectedVersion: null,
              outcome: "missing",
              reason: "Configure an interpreter on this host, then refresh",
            },
          ]
        : [],
    preflight: fixturePreflight(i),
    checkedAt: 123,
  }),
  runtime: Match.value(i).pipe(
    Match.when(0, () => P.LanguageRuntime.cases.AwaitingTrust.make({})),
    Match.when(6, () =>
      P.LanguageRuntime.cases.Failed.make({
        message: "Retry limit reached",
        attempts: 3,
        retryAt: null,
      })
    ),
    Match.orElse(() => P.LanguageRuntime.cases.Stopped.make({ reason: "no-demand" }))
  ),
  progress:
    i === 7
      ? P.LanguageInstallProgress.make({
          hostId,
          toolId: "fixture-tool",
          version: "1.0.0",
          jobId: "fake-install",
          sequence: 1,
          phase: "downloading",
          downloadedBytes: 10,
          totalBytes: 100,
          message: "Fake download",
          activeVersion: null,
        })
      : null,
  actions: fixtureActions(i),
});

const discovery = P.LanguageDiscovery.make({
  checkout,
  projectRoot: checkout.path,
  providers: [
    {
      providerId: "pyright",
      preflight: P.LanguagePreflight.cases.Blocked.make({
        reason: "awaiting-trust",
        message: "Project code requires workspace trust",
      }),
      launch: P.LanguageLaunchFact.make({
        providerId: "pyright",
        executable: "/fixture/pyright",
        argv: [],
        workingDirectory: checkout.path,
        environmentKeys: ["FAKE_KEY"],
        sdk: null,
        interpreter: "/fixture/.venv/bin/python",
        pluginProbeRoots: [],
        configurationFingerprint: "a".repeat(64),
      }),
      prerequisites: [],
    },
  ],
  effectiveSettings: effective,
  trust,
});

const reviewCheckout = P.LanguageCheckout.cases.ReviewCheckout.make({
  workspaceId,
  reviewCheckoutId: P.ReviewCheckoutId.make("fixture-review"),
  path: "/fixture/review",
});

const reviewDiscovery = P.LanguageDiscovery.make({
  ...discovery,
  checkout: reviewCheckout,
  projectRoot: reviewCheckout.path,
  trust: P.LanguageTrust.make({
    scope: P.LanguageTrustScope.cases.ReviewCheckout.make({
      hostId,
      workspaceId,
      reviewCheckoutId: reviewCheckout.reviewCheckoutId,
    }),
    revision: 1,
    trusted: false,
  }),
});

const fixtureHost = (i: number): LanguageSettingsSnapshot["hosts"][number] => ({
  key: `fake-${i}`,
  id: hostId,
  name:
    i === 0
      ? "Fake Linux VM · lucas/eng-169-research-herdr-dagrs-dag-model-with-a-very-long-host-name"
      : `Fake host ${i}`,
  connection: Match.value(i).pipe(
    Match.when(1, () => "Offline" as const),
    Match.when(2, () => "Reconnecting" as const),
    Match.when(3, () => "Needs Attention" as const),
    Match.orElse(() => "Connected" as const)
  ),
  capability: i === 4 ? "unsupported" : "available",
  detail: "Fake facts only · no execution or activation",
  recovery: Match.value(i).pipe(
    Match.when(1, () => "reconnect" as const),
    Match.when(3, () => "attention" as const),
    Match.when(4, () => "upgrade" as const),
    Match.orElse(() => null)
  ),
  discovery: Match.value(i).pipe(
    Match.when(0, () => discovery),
    Match.when(12, () => reviewDiscovery),
    Match.orElse(() => null)
  ),
  tools: [fixtureTool(i)],
});

export const fixtureSnapshot = (scope: P.LanguageSettingsScope): LanguageSettingsSnapshot => ({
  record: P.LanguageSettingsRecord.make({ scope, revision: 0, settings: {} }),
  effective,
  providers: [
    { id: "pyright", name: "Pyright · Python diagnostics" },
    { id: "ruff", name: "Ruff · lint and code actions" },
  ],
  formatters: [
    {
      key: "ruff",
      name: "Ruff · one formatter",
      selection: P.LanguageFormatterSelection.cases.Provider.make({ providerId: "ruff" }),
    },
  ],
  hosts: Array.from({ length: 13 }, (_, i) => fixtureHost(i)),
});

export const createFixture = () => {
  const records = new Map<string, typeof P.LanguageSettingsRecord.Type>();
  const calls: Array<string> = [];
  const control = { hold: false, fail: false, aborted: 0 };

  const pause = (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (!control.hold) {
        resolve();

        return;
      }

      signal.addEventListener(
        "abort",
        () => {
          control.aborted += 1;
          resolve();
        },
        { once: true }
      );
    });

  const adapter: LanguageSettingsAdapter = {
    load: async (scope, signal) => {
      calls.push("load");
      await pause(signal);

      if (control.fail)
        return { ok: false, message: "Fake host request failed. Refresh to retry." };
      const snapshot = fixtureSnapshot(scope);
      const record = records.get(JSON.stringify(scope)) ?? snapshot.record;

      return {
        ok: true,
        value: {
          ...snapshot,
          record,
          effective: {
            ...snapshot.effective,
            settings: record.settings,
            formatOnSave: record.settings.formatOnSave ?? true,
            providers: record.settings.providers ?? effective.providers,
            formatter: record.settings.formatter ?? effective.formatter,
          },
        },
      };
    },
    save: async (record, signal) => {
      calls.push("save");
      await pause(signal);

      if (control.fail)
        return { ok: false, message: "Fake revision conflict. Discard changes and refresh." };
      records.set(
        JSON.stringify(record.scope),
        P.LanguageSettingsRecord.make({ ...record, revision: record.revision + 1 })
      );

      return { ok: true, value: undefined };
    },
    act: async (action, signal) => {
      calls.push(action.kind);
      await pause(signal);

      return control.fail
        ? { ok: false, message: "Fake Host action failed. Refresh facts." }
        : { ok: true, value: undefined };
    },
  };

  return { adapter, calls, control };
};

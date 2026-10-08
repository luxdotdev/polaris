import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { LanguageRequestOutputs } from "../../../../shared/languages.ts";
import type { LanguageApi } from "../../../../shared/api.ts";
import { initialState, type AppState } from "../../../store/store.ts";
import { emptyHostModel } from "../../../store/hostModel.ts";
import { EditorLanguageCoordinator } from "./integration.ts";
import { EditorProviderFixture } from "./fixture.testing.ts";

/** One connected Host and Workspace ("reuse") whose files open in a real coordinator. */
export const coordinatorFixture = (
  doc = "export const value = 42;",
  discoveryFailure?: () => P.LanguageError | null
) => {
  const hostId = P.HostId.make("reuse");
  const workspaceId = P.WorkspaceId.make("reuse");
  const service = new EditorProviderFixture(hostId);
  const requests: string[] = [];
  let discoverGate: Promise<void> | null = null;
  let settingsRevision = 0;
  let settingsPatch: P.LanguageSettingsPatch = {};

  const api: LanguageApi = {
    request: async (method, input) => {
      requests.push(method);

      if (method === "languages.discover" && discoverGate !== null) await discoverGate;
      const failure = method === "languages.discover" ? discoveryFailure?.() : null;

      if (failure != null)
        return {
          ok: false,
          error: { code: "LanguageError", message: failure.message, languageError: failure },
        };
      const reply = await service.api.request(method, input);

      if (!reply.ok || method !== "languages.settings.get") return reply;
      const record = Schema.decodeUnknownSync(P.LanguageSettingsRecord)(reply.value);

      return {
        ok: true,
        value: Schema.decodeUnknownSync(LanguageRequestOutputs[method])(
          P.LanguageSettingsRecord.make({
            ...record,
            revision: settingsRevision,
            settings: settingsPatch,
          })
        ),
      };
    },
    subscribe: service.api.subscribe,
  };

  const workspace = new P.Workspace({
    id: workspaceId,
    path: "/reuse",
    name: "reuse",
    isGitRepo: true,
    worktreeRoot: "/reuse-trees",
    hidden: false,
    registeredAt: "2026-10-07T00:00:00Z",
  });

  const app: AppState = {
    ...initialState,
    hosts: [
      {
        key: "reuse",
        label: "reuse",
        colour: null,
        alias: null,
        proofHarness: false,
        status: {
          state: "connected",
          failure: null,
          attempt: 0,
          since: 0,
          nextAttemptAt: null,
          epoch: 1,
          latencyMs: null,
          lastSeenAt: null,
          capabilities: ["languages"],
          host: new P.HostInfo({
            hostId,
            hostname: "reuse",
            platform: "linux-x64",
            daemonVersion: "fixture",
            homeDir: "/reuse",
            startedAt: "2026-10-07T00:00:00Z",
          }),
        },
      },
    ],
    hostModels: { reuse: { ...emptyHostModel, workspaces: new Map([[workspaceId, workspace]]) } },
  };

  let epoch = 1;

  const coordinator = new EditorLanguageCoordinator(
    () => app,
    () => api,
    () => ({ hostId, clientId: "reuse-client", connectionEpoch: epoch })
  );

  const open = (name: string) => {
    let state = EditorState.create({ doc });

    // SAFETY: This coordinator fixture exercises only state and dispatch; no DOM view methods run.
    const view = {
      get state() {
        return state;
      },
      dispatch: (spec: TransactionSpec) => {
        state = state.update(spec).state;
      },
    } as EditorView;

    const path = `/reuse/${name}`;

    const lifetime = coordinator.mount({
      file: { hostKey: "reuse", workspaceId, path },
      root: "/reuse",
      view,
      revision: () => 1,
    });

    const key = `reuse\u0000${path}`;

    return {
      key,
      path,
      lifetime,
      view,
      entry: () => coordinator.get(key),
      text: () => state.doc.toString(),
    };
  };

  const settled = async (file: ReturnType<typeof open>) => {
    for (let count = 0; count < 100; count++) {
      if (file.entry()?.features.options.providers().length) return;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    throw new Error("Fixture did not become ready");
  };

  const providerOf = (file: ReturnType<typeof open>) =>
    file.entry()?.features.options.providers()[0];

  const replace = (
    file: ReturnType<typeof open> | ReturnType<typeof providerOf>,
    runtime: typeof P.LanguageRuntime.Type = P.LanguageRuntime.cases.Stopped.make({
      reason: "replaced",
    })
  ) => {
    const provider = file === undefined || "context" in file ? file : providerOf(file);

    if (provider === undefined) throw new Error("Missing fixture provider");

    const event = P.LanguageContextEvent.cases.Replaced.make({
      context: provider.context,
      replacement: P.LanguageContextIdentity.make({
        ...provider.context,
        generation: provider.context.generation + 1,
      }),
      runtime,
      ack: provider.ack,
    });

    service.generation++;

    for (const receive of service.subscribers.get(provider.context.contextId) ?? []) receive(event);
  };

  return {
    app,
    workspaceId,
    coordinator,
    service,
    providerOf,
    holdDiscovery: () => {
      let release = () => {};

      discoverGate = new Promise<void>((resolve) => {
        release = () => {
          discoverGate = null;
          resolve();
        };
      });

      return release;
    },
    requests,
    open,
    settled,
    replace,
    override: () => {
      settingsRevision++;
      settingsPatch = {
        executableOverrides: { fixture: { executable: "/reuse/tool", argv: [], environment: {} } },
      };
      coordinator.refreshSettings("reuse", "reuse");
    },
    reconnect: () => {
      epoch++;
      coordinator.refreshHosts();
    },
  };
};

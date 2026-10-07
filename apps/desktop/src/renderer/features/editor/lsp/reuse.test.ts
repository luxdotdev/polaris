import { expect, test } from "bun:test";
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
import { languageStore } from "./state.ts";

const fixture = () => {
  const hostId = P.HostId.make("reuse");
  const workspaceId = P.WorkspaceId.make("reuse");
  const service = new EditorProviderFixture(hostId);
  const requests: string[] = [];
  let settingsRevision = 0;
  let settingsPatch: P.LanguageSettingsPatch = {};

  const api: LanguageApi = {
    request: async (method, input) => {
      requests.push(method);
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
    let state = EditorState.create({ doc: "export const value = 42;" });

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

    return { key, lifetime, entry: () => coordinator.get(key) };
  };

  const settled = async (file: ReturnType<typeof open>) => {
    for (let count = 0; count < 100; count++) {
      if (file.entry()?.features.options.providers().length) return;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    throw new Error("Fixture did not become ready");
  };

  const replace = (file: ReturnType<typeof open>) => {
    const provider = file.entry()?.features.options.providers()[0];

    if (provider === undefined) throw new Error("Missing fixture provider");

    const event = P.LanguageContextEvent.cases.Replaced.make({
      context: provider.context,
      replacement: P.LanguageContextIdentity.make({
        ...provider.context,
        generation: provider.context.generation + 1,
      }),
      runtime: P.LanguageRuntime.cases.Stopped.make({ reason: "replaced" }),
      ack: provider.ack,
    });

    service.generation++;

    for (const receive of service.subscribers.get(provider.context.contextId) ?? []) receive(event);
  };

  return {
    coordinator,
    service,
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

test("second preview joins the live context with only didClose/didOpen, becomes ready and receives diagnostics", async () => {
  const f = fixture();

  try {
    const a = f.open("a.ts");
    await f.settled(a);
    const context = a.entry()?.features.options.providers()[0]?.context;
    a.lifetime.dispose();
    const start = f.requests.length;
    const b = f.open("b.ts");
    await f.settled(b);
    expect(f.requests.slice(start)).toEqual(["languages.document.sync", "languages.document.sync"]);
    expect(b.entry()?.features.options.providers()[0]?.context).toEqual(context);
    expect(languageStore.getState().files[b.key]?.status).toBe("ready");
    f.service.diagnose("file:///reuse/b.ts");
    expect(b.entry()?.diagnostics.values()).toHaveLength(1);
    expect(f.service.releases).toBe(0);
  } finally {
    f.coordinator.dispose();
  }

  expect(f.service.releases).toBe(1);
});

for (const reason of ["tsconfig change", "Trust change"]) {
  test(`${reason} replacement invalidates discovery before the next file opens`, async () => {
    const f = fixture();

    try {
      const a = f.open("a.ts");
      await f.settled(a);
      f.replace(a);
      await f.settled(a);
      const start = f.requests.length;
      const b = f.open("b.ts");
      await f.settled(b);
      expect(
        f.requests.slice(start).filter((method) => method === "languages.discover")
      ).toHaveLength(1);
      expect(b.entry()?.features.options.providers()[0]?.context.generation).toBe(2);
    } finally {
      f.coordinator.dispose();
    }
  });
}

test("provider override refreshes Settings and discovery, while nested directories discover independently", async () => {
  const f = fixture();

  try {
    const a = f.open("a.ts");
    await f.settled(a);
    const start = f.requests.length;
    f.override();
    await f.settled(a);
    expect(
      f.requests.slice(start).filter((method) => method === "languages.discover")
    ).toHaveLength(1);
    expect(
      a.entry()?.groups[0]?.acquisition.settings.settings.executableOverrides?.fixture?.executable
    ).toBe("/reuse/tool");
    const beforeNested = f.requests.length;
    const nested = f.open("nested/b.ts");
    await f.settled(nested);
    expect(
      f.requests.slice(beforeNested).filter((method) => method === "languages.discover")
    ).toHaveLength(1);
  } finally {
    f.coordinator.dispose();
  }
});

test("authenticated connection replacement retires retained contexts and re-observes", async () => {
  const f = fixture();

  try {
    const a = f.open("a.ts");
    await f.settled(a);
    const context = a.entry()?.features.options.providers()[0]?.context;
    f.reconnect();
    await f.settled(a);
    expect(f.service.releases).toBe(1);
    expect(a.entry()?.features.options.providers()[0]?.context.contextId).not.toBe(
      context?.contextId
    );
    expect(f.requests.filter((method) => method === "languages.discover")).toHaveLength(2);
  } finally {
    f.coordinator.dispose();
  }
});

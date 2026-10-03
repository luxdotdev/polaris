import "../../../styles.css";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import { HostId, HostInfo, Workspace, WorkspaceId, LanguagePreviewPolicy } from "@polaris/protocol";
import { Schema } from "effect";
import { undo } from "@codemirror/commands";
import { Toaster, TooltipProvider } from "@polaris/ui";
import type { LanguageApi, PolarisApi } from "../../../../shared/api.ts";
import {
  LanguageRequestOutputs,
  type LanguageRequestMethod,
  type LanguageRequestInput,
} from "../../../../shared/languages.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { installKeyboard } from "../../../routes/keyboard.ts";
import { initialState, type AppState, type Connection } from "../../../store/store.ts";
import { emptyHostModel } from "../../../store/hostModel.ts";
import { standInBridge } from "../../bridge.ts";
import { createFakeFiles } from "../files/fake.ts";
import { fileKey, workspaceKey, readTabs } from "../model/drafts.ts";
import { ensureEditor } from "../runtime/app.ts";
import { viewOf, dirtyKeys } from "../runtime/buffers.ts";
import {
  openFile,
  closeTab,
  activateTab,
  openMarkdownPreview,
  setWorkspaceRoot,
} from "../runtime/actions.ts";
import { editorStore, tabsOf } from "../runtime/store.ts";
import { EditorPane } from "../ui/EditorPane.tsx";

const hostKey = "fake-linux";

const workspaceId = WorkspaceId.make("ws-editor-fixture");

const hostId = HostId.make("host-editor-fixture");

const root = "/fixture";

const a = "/fixture/docs/a.md";

const b = "/fixture/docs/b.md";

const source =
  "# Original source\n\n[Jump](#original-source) · [Guide](b.md#guide)\n\n|Name|Value|\n|---|---|\n|One|Two|\n\n- [x] Task\n\n~~Removed~~\n\n![Local](tiny.png)\n\n![External](https://example.invalid/tiny.png)";

const files = createFakeFiles({
  [hostKey]: { [a]: source, [b]: "# Guide\n\nGuide text", "/fixture/code.ts": "const code = 1;" },
});

const kv = globalThis.localStorage;

const calls: Array<{ method: string; input: unknown }> = [];

const created: Array<string> = [];

const revoked: Array<string> = [];

const create = URL.createObjectURL.bind(URL);

const revoke = URL.revokeObjectURL.bind(URL);

URL.createObjectURL = (blob) => {
  const url = create(blob);
  created.push(url);

  return url;
};

URL.revokeObjectURL = (url) => {
  revoked.push(url);
  revoke(url);
};

let policy = LanguagePreviewPolicy.make({
  hostId,
  workspaceId,
  externalImages: "ask",
  scripts: "disabled",
  html: "sanitized",
  mermaid: "strict",
  maxMediaBytes: 10485760,
});

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

const languageApi: LanguageApi = {
  request: async <M extends LanguageRequestMethod>(method: M, input: LanguageRequestInput<M>) => {
    calls.push({ method, input });
    let value: LanguagePreviewPolicy | { mimeType: string; bytes: number; base64: string };

    if (method === "languages.preview.policy.get") value = policy;
    else if (method === "languages.preview.policy.set") {
      policy = LanguagePreviewPolicy.make({ ...policy, externalImages: "allow" });
      value = policy;
    } else if (method === "languages.preview.media" || method === "languages.preview.external")
      value = { mimeType: "image/png", bytes: atob(png).length, base64: png };
    else
      return {
        ok: false,
        error: { code: "Unsupported", message: "Fixture optional capability absent" },
      };

    return { ok: true, value: Schema.decodeUnknownSync(LanguageRequestOutputs[method])(value) };
  },
  subscribe: () => () => undefined,
};

const bridge: PolarisApi = {
  languages: languageApi,
  request: async () => {
    return { ok: false, error: { code: "Unsupported", message: "Fixture" } };
  },
  subscribe: () => () => undefined,
  onAppEvent: () => () => undefined,
};

const host = {
  key: hostKey,
  label: "Fake Linux",
  colour: null,
  alias: "fake",
  proofHarness: false,
  status: {
    state: "connected",
    failure: null,
    attempt: 0,
    since: 0,
    nextAttemptAt: null,
    host: new HostInfo({
      hostId,
      hostname: "fake-linux",
      platform: "linux-x64",
      daemonVersion: "fixture",
      homeDir: "/home/fake",
      startedAt: "2026-10-02T00:00:00Z",
    }),
    capabilities: [],
    epoch: 1,
    latencyMs: 15,
    lastSeenAt: null,
  },
} satisfies AppState["hosts"][number];

const workspace = new Workspace({
  id: workspaceId,
  path: root,
  name: "fixture",
  isGitRepo: true,
  worktreeRoot: "/fixture.worktrees",
  hidden: false,
  registeredAt: "2026-10-02T00:00:00Z",
});

const store = createStore<AppState>(() => ({
  ...initialState,
  hosts: [host],
  hostModels: {
    [hostKey]: { ...emptyHostModel, workspaces: new Map([[workspace.id, workspace]]) },
  },
}));

const connection: Connection = {
  store,
  openSession: () => () => undefined,
  setDensity: (density) => store.setState({ density }),
  setAppearance: (patch) => store.setState(patch),
};

const navigation = createNavigation({ app: store, storage: null });

const commands = createCommandRegistry({ mac: true });

standInBridge(bridge);

installKeyboard({ actions: navigation.actions, registry: commands });

setWorkspaceRoot(hostKey, workspaceId, root);

ensureEditor({ app: () => store.getState(), files, kv, canWrite: () => true });

if (!Object.keys(readTabs(kv)).length) openFile({ hostKey, workspaceId, path: a });

const element = document.getElementById("root");

if (element === null) throw new Error("Fixture root missing");

createRoot(element).render(
  <AppProvider value={{ connection, navigation, commands }}>
    <TooltipProvider>
      <div className="bg-bg text-text-default flex h-screen flex-col">
        <EditorPane hostKey={hostKey} workspaceId={workspaceId} root={root} />
        <Toaster />
      </div>
    </TooltipProvider>
  </AppProvider>
);

Object.assign(window, {
  fixture: {
    calls,
    created,
    revoked,
    snapshot: () => ({
      tabs: tabsOf(editorStore.getState(), workspaceKey(hostKey, workspaceId)),
      dirty: dirtyKeys(),
      watching: files.watching(),
      text: viewOf(fileKey(hostKey, a))?.state.sliceDoc(),
      persisted: readTabs(kv),
    }),
    source: () => activateTab(hostKey, workspaceId, a),
    preview: () => openMarkdownPreview(hostKey, workspaceId),
    open: (path: string, preview = false) => openFile({ hostKey, workspaceId, path, preview }),
    close: (id: string) => closeTab(hostKey, workspaceId, id),
    replace: (text: string) => {
      const view = viewOf(fileKey(hostKey, a));
      view?.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        userEvent: "input.type",
      });
    },
    undo: () => {
      const view = viewOf(fileKey(hostKey, a));

      if (view !== null) undo(view);
    },
    agent: (text: string) => files.agentWrite(hostKey, a, text),
    offline: (offline: boolean) =>
      store.setState({
        hosts: [
          {
            ...host,
            status: {
              ...host.status,
              state: offline ? "reconnecting" : "connected",
              epoch: offline ? 1 : 2,
            },
          },
        ],
      }),
    oldHost: (old: boolean) => {
      const oldBridge: PolarisApi = {
        request: bridge.request,
        subscribe: bridge.subscribe,
        onAppEvent: bridge.onAppEvent,
      };

      standInBridge(old ? oldBridge : bridge);
      store.setState({ hosts: [{ ...host, status: { ...host.status, epoch: old ? 3 : 4 } }] });
    },
  },
});

import "../../../styles.css";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import { Toaster, TooltipProvider } from "@polaris/ui";
import * as P from "@polaris/protocol";
import { startCompletion, currentCompletions, acceptCompletion } from "@codemirror/autocomplete";
import { diagnosticCount } from "@codemirror/lint";
import { undo } from "@codemirror/commands";
import type { PolarisApi } from "../../../../shared/api.ts";
import { initialState, type AppState, type Connection } from "../../../store/store.ts";
import { emptyHostModel } from "../../../store/hostModel.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { standInBridge } from "../../bridge.ts";
import { createFakeFiles } from "../files/fake.ts";
import { fileKey } from "../model/drafts.ts";
import { ensureEditor, editorLanguages, editorLanguageQueries } from "../runtime/app.ts";
import { openFile, setWorkspaceRoot } from "../runtime/actions.ts";
import {
  configureEditor,
  whenLoaded,
  viewOf,
  dirtyKeys,
  resetBuffers,
} from "../runtime/buffers.ts";
import { EditorPane } from "../ui/EditorPane.tsx";
import { EditorProviderFixture } from "./fixture.testing.ts";

const hostKey = "editor-language-fixture";

const hostId = P.HostId.make("editor-language-fixture");

const workspaceId = P.WorkspaceId.make("left");

const rightId = P.WorkspaceId.make("right");

const path = "/left/main.ts";

const file = { hostKey, workspaceId, path };

const key = fileKey(hostKey, path);

const providers = new EditorProviderFixture(hostId);

const files = createFakeFiles({
  [hostKey]: {
    [path]: "const value = '😀';\nvalue",
    "/left/hidden.ts": "let hidden = 1;",
    "/right/main.ts": "const right = 1;",
  },
});

const workspace = (id: P.WorkspaceId, root: string) =>
  new P.Workspace({
    id,
    path: root,
    name: id,
    isGitRepo: true,
    worktreeRoot: `${root}.worktrees`,
    hidden: false,
    registeredAt: "2026-10-02T00:00:00Z",
  });

const left = workspace(workspaceId, "/left");

const right = workspace(rightId, "/right");

const host: AppState["hosts"][number] = {
  key: hostKey,
  label: "Scripted Host",
  colour: null,
  alias: null,
  proofHarness: false,
  status: {
    state: "connected",
    failure: null,
    attempt: 0,
    since: 0,
    nextAttemptAt: null,
    host: new P.HostInfo({
      hostId,
      hostname: "fixture",
      platform: "linux-x64",
      daemonVersion: "fixture",
      homeDir: "/home/fake",
      startedAt: "2026-10-02T00:00:00Z",
    }),
    capabilities: ["languages", "files.write"],
    epoch: 1,
    latencyMs: null,
    lastSeenAt: null,
  },
};

const store = createStore<AppState>(() => ({
  ...initialState,
  hosts: [host],
  hostModels: {
    [hostKey]: {
      ...emptyHostModel,
      synchronized: true,
      workspaces: new Map([
        [left.id, left],
        [right.id, right],
      ]),
    },
  },
}));

const connection: Connection = {
  store,
  openSession: () => () => {},
  setDensity: (density) => store.setState({ density }),
  setAppearance: (patch) => store.setState(patch),
};

const api: PolarisApi = {
  languages: providers.api,
  request: async () => ({
    ok: false,
    error: { code: "unavailable", message: "No production Main in fixture." },
  }),
  subscribe: () => () => {},
  onAppEvent: () => () => {},
};

standInBridge(api);

setWorkspaceRoot(hostKey, workspaceId, "/left");

setWorkspaceRoot(hostKey, rightId, "/right");

ensureEditor({
  app: () => store.getState(),
  files,
  kv: null,
  spill: null,
  canWrite: () => true,
  subscribeApp: (changed) => store.subscribe(changed),
  languageIdentity: () => {
    const status = store.getState().hosts[0]?.status;

    return status?.state === "connected"
      ? { hostId, clientId: "independent-fixture-client", connectionEpoch: status.epoch }
      : null;
  },
});

if (editorLanguages === null) throw new Error("The scripted Editor did not start.");

configureEditor({
  files,
  kv: null,
  spill: null,
  languages: editorLanguages,
  prefs: () => ({ vim: false, autosave: false }),
  canWrite: () => true,
  hostLabel: () => "Scripted Host",
  hostHome: () => null,
});

openFile(file);

const root = document.getElementById("root");

if (root === null) throw new Error("Missing fixture root");

const navigation = createNavigation({ app: store, storage: null });

const commands = createCommandRegistry({ mac: true });

createRoot(root).render(
  <AppProvider value={{ connection, navigation, commands }}>
    <TooltipProvider>
      <div className="bg-bg text-text-default flex h-screen flex-col">
        <EditorPane hostKey={hostKey} workspaceId={workspaceId} root="/left" />
        <Toaster />
      </div>
    </TooltipProvider>
  </AppProvider>
);

const waitFor = async (condition: () => boolean) => {
  const until = performance.now() + 5000;

  while (!condition()) {
    if (performance.now() > until) throw new Error("Fixture condition timed out");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
};

const facts: string[] = [];

const check = (condition: boolean, fact: string) => {
  if (!condition) throw new Error(fact);
  facts.push(fact);
};

Object.assign(window, {
  languageProof: {
    async cleanup() {
      resetBuffers();
      editorLanguages?.dispose();
      await waitFor(() => providers.contexts.size === 0 && providers.subscribers.size === 0);

      return {
        watches: files.watching(),
        contexts: providers.contexts.size,
        subscriptions: providers.subscribers.size,
      };
    },
    async run() {
      await whenLoaded(key);
      await waitFor(
        () => (editorLanguages?.get(key)?.features.options.providers().length ?? 0) > 0
      );
      const view = viewOf(key);

      if (view === null) throw new Error("Missing actual CodeMirror view");
      view.dispatch({
        changes: { from: view.state.doc.length, insert: " unsaved😀" },
        selection: { anchor: view.state.doc.length + 10 },
      });
      await waitFor(
        () => (editorLanguages?.get(key)?.features.options.providers().length ?? 0) > 0
      );
      const before = view.state.doc.toString();
      const entry = editorLanguages?.get(key);

      if (entry === undefined) throw new Error("Missing language entry");
      const provider = entry.features.options.providers()[0];
      check(
        provider !== undefined &&
          providers.contexts.get(provider.context.contextId)?.documents.get(entry.read().uri)
            ?.text === before,
        "actual unsaved Unicode buffer acknowledged before feature requests"
      );
      startCompletion(view);
      await waitFor(() =>
        currentCompletions(view.state).some((item) => item.label === "fixtureCompletion")
      );
      let accepted = false;

      // The visible completion list precedes CodeMirror's interaction readiness interval.
      await waitFor(() => (accepted = acceptCompletion(view)));
      check(accepted, "actual CodeMirror completion accepted");
      check(
        undo(view) && view.state.doc.toString() === before,
        "completion retains authoritative undo and draft"
      );
      await waitFor(() => entry.features.options.providers().length > 0);
      let release = () => {};

      providers.hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const obsolete = entry.features.hover(view.state.selection.main.head);
      await waitFor(() =>
        providers.requests.some((request) => request.method === "textDocument/hover")
      );
      view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
      undo(view);
      providers.hold = null;
      release();
      check(
        (await obsolete).length === 0,
        "late feature answer cannot resurrect after typing and undo"
      );
      await waitFor(() => entry.features.options.providers().length > 0);
      providers.diagnose(entry.read().uri);
      await waitFor(() => diagnosticCount(view.state) > 0);
      check(
        diagnosticCount(view.state) === 1,
        "actual CodeMirror diagnostic receives synced provider feed"
      );
      await editorLanguageQueries?.run(key, "references");
      check(
        providers.requests.some((request) => request.method === "textDocument/references"),
        "references use acknowledged unsaved document"
      );
      const hidden = { hostKey, workspaceId, path: "/left/hidden.ts" };
      openFile(hidden);
      await whenLoaded(fileKey(hostKey, hidden.path));
      await waitFor(
        () =>
          (editorLanguages?.get(fileKey(hostKey, hidden.path))?.features.options.providers()
            .length ?? 0) > 0
      );
      check(
        viewOf(key) === view && dirtyKeys().includes(key),
        "hidden tab retains same CodeMirror view and unsaved draft"
      );
      openFile({ hostKey, workspaceId: rightId, path: "/right/main.ts" });
      await whenLoaded(fileKey(hostKey, "/right/main.ts"));
      await waitFor(() =>
        [...providers.contexts.values()].some((item) => item.context.checkout.path === "/right")
      );
      check(
        [...providers.contexts.values()].some((item) => item.context.checkout.path === "/left"),
        "two registered roots retain independent contexts"
      );
      files.agentWrite(hostKey, path, "Agent disk text");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      check(
        view.state.doc.toString() === before && dirtyKeys().includes(key),
        "Agent disk change retains dirty source and undo authority"
      );
      store.setState((state) => ({
        hosts: state.hosts.map((item) => ({
          ...item,
          status: { ...item.status, state: "offline" },
        })),
      }));
      await waitFor(() => entry.features.options.providers().length === 0);
      providers.generation++;
      store.setState((state) => ({
        hosts: state.hosts.map((item) => ({
          ...item,
          status: { ...item.status, state: "connected", epoch: 2 },
        })),
      }));
      await waitFor(() => entry.features.options.providers()[0]?.context.generation === 2);
      check(
        viewOf(key) === view && view.state.doc.toString() === before,
        "reconnect reopens latest exact draft without replacing CodeMirror view"
      );
      openFile(file);
      await editorLanguageQueries?.run(key, "symbols");

      return {
        facts,
        requests: providers.requests.map((item) => item.method),
        notifications: providers.notifications.length,
      };
    },
  },
});

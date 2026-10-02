/**
 * The editor on fixtures, for screenshots against Paper E1–E3 and the editor
 * budgets: `#editor/<scene>` renders the pane, a stand-in explorer column and
 * the status bar on in-memory files. Scenes: e1, close, conflict, compare, reload,
 * vim, find, tabs20, readonly, binary, empty, big (`?persist` keeps drafts in localStorage). Its own chunk.
 */
import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { TooltipProvider } from "@polaris/ui";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import type { Density, PolarisApi } from "../../../../shared/api.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { installKeyboard } from "../../../routes/keyboard.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { type AppState, type Connection, initialState } from "../../../store/store.ts";
import { standInBridge } from "../../bridge.ts";
import { settingsStore } from "../../settings/index.ts";
import { createFakeFiles, type FakeFiles } from "../files/fake.ts";
import { memoryKeyValue } from "../model/drafts.ts";
import { closeTab, openFile, setAgentFiles } from "../runtime/actions.ts";
import { ensureEditor } from "../runtime/app.ts";
import { getActiveEditor } from "../runtime/hooks.ts";
import { EditorPane } from "../ui/EditorPane.tsx";
import { EditorStatus } from "../ui/EditorStatus.tsx";
import { FILES, HOST, path, ROOT, WORKSPACE } from "./fixtures.ts";

const bridge: PolarisApi = {
  request: () => Promise.resolve({ ok: false, error: { code: "Unsupported", message: "preview" } }),
  subscribe: () => () => undefined,
  onAppEvent: () => () => undefined,
};

const RECONNECT = path("daemon/src/hosts/reconnect.ts");

const SESSION_ROW = path("desktop/src/orchestrator/session-row.tsx");

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** The active editor once its file has loaded. */
const activeView = async (): Promise<EditorView> => {
  for (;;) {
    const view = getActiveEditor()?.view;

    if (view !== undefined) return view;
    await nextFrame();
  }
};

const E1_TABS = [RECONNECT, path("daemon/src/hosts/transport.ts"), SESSION_ROW, path("CONTEXT.md")];

const openE1 = () => {
  for (const p of E1_TABS) openFile({ hostKey: HOST, workspaceId: WORKSPACE, path: p });
  openFile({ hostKey: HOST, workspaceId: WORKSPACE, path: RECONNECT, line: 28, column: 14 });
  setAgentFiles(HOST, WORKSPACE, new Map([[SESSION_ROW, "claude"]]));
};

/** E1: an unsaved edit in reconnect.ts, as the artboard's dot says. */
const typeEdit = async () => {
  const view = await activeView();

  view.dispatch({
    changes: { from: view.state.doc.line(6).to, insert: " // ms" },
    userEvent: "input.type",
  });
};

const agentEdit = (files: FakeFiles) => {
  const before = files.text(HOST, RECONNECT) ?? "";

  files.agentWrite(
    HOST,
    RECONNECT,
    before.replace("const MAX_ATTEMPTS = 8;", "const MAX_ATTEMPTS = 12;\nconst JITTER_MS = 250;")
  );
};

const tabs20 = () => {
  for (let i = 0; i < 20; i++) {
    const file = `${ROOT}/daemon/src/generated/module-${String(i).padStart(2, "0")}.ts`;

    openFile({ hostKey: HOST, workspaceId: WORKSPACE, path: file });
  }
};

type Scene = (files: FakeFiles) => Promise<void> | void;

const SCENES = new Map<string, Scene>(
  Object.entries({
    e1: async () => {
      openE1();
      await typeEdit();
    },
    close: async () => {
      openE1();
      await typeEdit();
      closeTab(HOST, WORKSPACE, RECONNECT);
    },
    conflict: async (files) => {
      openE1();
      await typeEdit();
      agentEdit(files);
    },
    compare: async (files) => {
      openE1();
      await typeEdit();
      agentEdit(files);
      await nextFrame();
      document.querySelector<HTMLButtonElement>('[data-testid="editor-banner"] button')?.click();
    },
    reload: async (files) => {
      openE1();
      await activeView();
      agentEdit(files);
    },
    vim: () => openE1(),
    find: async () => {
      openE1();
      openSearchPanel(await activeView());
    },
    tabs20,
    readonly: () => openFile({ hostKey: HOST, workspaceId: WORKSPACE, path: RECONNECT }),
    binary: () =>
      openFile({ hostKey: HOST, workspaceId: WORKSPACE, path: path("design/assets/logo.png") }),
    big: () => openFile({ hostKey: HOST, workspaceId: WORKSPACE, path: path("bench/big.ts") }),
    empty: () => undefined,
  } satisfies Record<string, Scene>)
);

const seed = () => {
  const generated = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [
      `${ROOT}/daemon/src/generated/module-${String(i).padStart(2, "0")}.ts`,
      (FILES[RECONNECT] ?? "").repeat(40),
    ])
  );

  return { [HOST]: { ...FILES, ...generated }, pi: FILES };
};

const Frame = () => (
  <div className="bg-bg text-text-default flex h-full flex-col">
    <div className="flex min-h-0 flex-1">
      <aside
        aria-label="Explorer (stand-in)"
        className="border-hairline bg-surface-sunken flex w-[264px] shrink-0 flex-col border-r px-4 py-3"
      >
        <p className="text-heading-sm text-text-strong">polaris</p>
        <p className="text-caption text-text-subtle">Mac Studio · ~/code/polaris</p>
      </aside>
      <EditorPane hostKey={HOST} workspaceId={WORKSPACE} root={ROOT} />
    </div>
    <footer className="border-hairline bg-surface-sunken text-caption text-text-subtle flex h-[26px] shrink-0 items-center gap-4 border-t px-3">
      <span>Mac Studio</span>
      <span>main</span>
      <span className="flex-1" />
      <EditorStatus hostKey={HOST} workspaceId={WORKSPACE} />
    </footer>
  </div>
);

export const mountEditorPreview = (root: HTMLElement, hash: string) => {
  const scene = hash.replace(/^#editor\//, "").split("?")[0] ?? "e1";
  const store = createStore<AppState>(() => ({ ...initialState }));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: (density: Density) => store.setState({ density }),
    setAppearance: ({ density, theme }) => store.setState({ density, theme }),
  };

  const navigation = createNavigation({ app: store, storage: null });
  const commands = createCommandRegistry({ mac: true });
  const files = createFakeFiles(seed(), { readOnlyHosts: ["pi"] });

  standInBridge(bridge);
  installKeyboard({ actions: navigation.actions, registry: commands });

  if (scene === "vim") {
    settingsStore.setState((s) => ({ sessions: { ...s.sessions, editorVim: true } }));
  }

  ensureEditor({
    app: () => store.getState(),
    files,
    // `?persist`: drafts and tabs in localStorage, as the app keeps them, for the restart check.
    kv: hash.includes("?persist") ? globalThis.localStorage : memoryKeyValue(),
    canWrite: () => scene !== "readonly",
  });

  createRoot(root).render(
    <AppProvider value={{ connection, navigation, commands }}>
      <TooltipProvider>
        <Frame />
      </TooltipProvider>
    </AppProvider>
  );

  void SCENES.get(scene)?.(files);
  Object.assign(window, {
    __polarisEditor: {
      files,
      openFile,
      closeTab,
      activeView: () => getActiveEditor()?.view ?? null,
    },
  });

  return connection.setDensity;
};

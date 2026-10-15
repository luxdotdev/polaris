/**
 * `#edit-prediction/<scene>`: the Editor on the Paper EP fixtures with an Edit Prediction drawn
 * directly into its state, so every display state can be screenshotted without a model. Scenes:
 * replace, multiline, delete, delete-large, jump, jump-offscreen, jumped, subtle, subtle-held,
 * insert. Its own chunk.
 */
import { Toaster, TooltipProvider } from "@polaris/ui";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import type { Density, PolarisApi } from "../../../../../shared/api.ts";
import { AppProvider } from "../../../../shell/hooks.ts";
import { createCommandRegistry } from "../../../../routes/commands.ts";
import { installKeyboard } from "../../../../routes/keyboard.ts";
import { createNavigation } from "../../../../routes/navigation.ts";
import { type AppState, type Connection, initialState } from "../../../../store/store.ts";
import { standInBridge } from "../../../bridge.ts";
import { createFakeFiles } from "../../files/fake.ts";
import { memoryKeyValue } from "../../model/drafts.ts";
import { memorySpill } from "../../model/draftStore.ts";
import { openFile } from "../../runtime/actions.ts";
import { ensureEditor } from "../../runtime/app.ts";
import { getActiveEditor } from "../../runtime/hooks.ts";
import { EditorPane } from "../../ui/EditorPane.tsx";
import { EditorStatus } from "../../ui/EditorStatus.tsx";
import { HOST, ROOT, WORKSPACE } from "../../preview/fixtures.ts";
import { setAltHeld } from "../edit/state.ts";
import { setEditPrediction, setGhost } from "../index.ts";
import { predictionStore } from "../store.ts";
import { EDIT_SCENES, SCORE_PATH, type EditScene } from "./editFixtures.ts";

const bridge: PolarisApi = {
  request: () => Promise.resolve({ ok: false, error: { code: "Unsupported", message: "preview" } }),
  subscribe: () => () => undefined,
  onAppEvent: () => () => undefined,
};

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const activeView = async () => {
  for (;;) {
    const view = getActiveEditor()?.view;

    if (view !== undefined && view.state.doc.length > 0) return view;
    await nextFrame();
  }
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

const draw = async (scene: EditScene) => {
  const view = await activeView();
  const placed = scene.place(view.state.doc.toString());
  await nextFrame();

  if (placed.ghost !== undefined) {
    view.dispatch({
      selection: { anchor: placed.cursor },
      effects: setGhost.of({ at: placed.cursor, text: placed.ghost }),
    });

    return;
  }

  view.dispatch({
    selection: { anchor: placed.cursor },
    effects: [
      setEditPrediction.of({
        id: "preview",
        hunks: placed.hunks,
        cursor: null,
        window: { from: 0, to: view.state.doc.length },
        doc: view.state.doc,
        anchor: placed.anchor ?? placed.cursor,
        phase: placed.phase ?? "shown",
        shownAt: performance.now() - 1000,
        finalToShown: 0,
        model: "zeta-2.1",
        format: "zeta-2.1",
        side: "client",
        requestToFinal: 1500,
      }),
      ...(scene.altHeld ? [setAltHeld.of(true)] : []),
    ],
    scrollIntoView: false,
  });
  view.focus();
};

export const mountEditPredictionPreview = (root: HTMLElement, hash: string) => {
  const name = hash.replace(/^#edit-prediction\//, "").split("?")[0] ?? "replace";
  const scene = EDIT_SCENES.get(name) ?? EDIT_SCENES.get("replace");

  if (scene === undefined) throw new Error("edit prediction preview has no scenes");
  const store = createStore<AppState>(() => ({ ...initialState }));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: (density: Density) => store.setState({ density }),
    setAppearance: ({ density, theme }) => store.setState({ density, theme }),
  };

  const navigation = createNavigation({ app: store, storage: null });
  const commands = createCommandRegistry({ platform: "mac" });
  const files = createFakeFiles({ [HOST]: { [SCORE_PATH]: scene.doc } });
  standInBridge(bridge);
  installKeyboard({ actions: navigation.actions, registry: commands });
  predictionStore.setState((state) => ({
    enabled: true,
    configured: true,
    loaded: true,
    preferences: {
      ...state.preferences,
      [HOST]: { ...scene.preferences },
    },
    results: {
      [HOST]: { model: "zeta-2.1-q8", machine: "Mac Studio", elapsedMs: 1500, side: "client" },
    },
  }));

  ensureEditor({
    app: () => store.getState(),
    files,
    kv: memoryKeyValue(),
    spill: memorySpill(),
    canWrite: () => true,
  });

  createRoot(root).render(
    <AppProvider value={{ connection, navigation, commands }}>
      <TooltipProvider>
        <Frame />
        <Toaster />
      </TooltipProvider>
    </AppProvider>
  );

  openFile({ hostKey: HOST, workspaceId: WORKSPACE, path: SCORE_PATH });
  void draw(scene);

  return connection.setDensity;
};

/**
 * The selection bar, the inline card and the ⌘L picker on a plain CodeMirror view, for
 * screenshots against Paper E2a (47M-0) and E2 (3AG-0): `#editor-inline/<scene>` with scene
 * selection, card, thinking, proposed, answer, failed, stale, add.
 */
import { javascript } from "@codemirror/lang-javascript";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { EditorView, highlightActiveLine, lineNumbers } from "@codemirror/view";
import {
  AgentSession,
  HARNESS_CATALOGUE,
  Sequence,
  SessionId,
  SessionSummary,
  Workspace,
  WorkspaceId,
} from "@polaris/protocol";
import { Toaster, TooltipProvider } from "@polaris/ui";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import type { HostView, PolarisApi } from "../../../../shared/api.ts";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { modelFromSnapshot } from "../../../store/hostModel.ts";
import { type AppState, type Connection, initialState } from "../../../store/store.ts";
import { standInBridge } from "../../bridge.ts";
import { MODELS } from "../../session/preview/fixtureData.ts";
import { openInlineCard, submitCard } from "../actions.ts";
import { cardOf, inlineExtensions } from "../cm/index.ts";
import { type Proposer, scriptedProposer, setProposer } from "../data/proposer.ts";
import { cards, patchCard } from "../store.ts";
import { addSelectionToSession } from "../ui/AddToSession.tsx";
import { InlineLayers } from "../ui/InlineLayers.tsx";
import { CODE, PROPOSAL } from "./code.ts";

const HOST = "preview";

const workspaceId = WorkspaceId.make("polaris");

const file = { hostKey: HOST, workspaceId, path: "/code/polaris/daemon/src/hosts/reconnect.ts" };

const host: HostView = {
  key: HOST,
  label: "Mac Studio",
  colour: null,
  alias: null,
  proofHarness: false,
  status: {
    state: "connected",
    failure: null,
    attempt: 0,
    since: 0,
    nextAttemptAt: null,
    host: null,
    capabilities: ["inline.propose", "harness.availability"],
    epoch: 1,
    latencyMs: null,
    lastSeenAt: null,
  },
};

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 2, 9, minutes)).toISOString();

const session = (id: string, title: string, harness: string, minutes: number) =>
  new SessionSummary({
    session: new AgentSession({
      id: SessionId.make(id),
      workspaceId,
      harness,
      title,
      cwd: "/code/polaris",
      worktreeId: null,
      state: "idle",
      permissionMode: "supervised",
      model: null,
      effort: null,
      parentSessionId: null,
      forkedFromTurnId: null,
      harnessCursor: null,
      turnCount: 1,
      contextUsage: null,
      lastError: null,
      createdAt: at(minutes),
      updatedAt: at(minutes),
    }),
    pendingApprovals: [],
    lastTurnPreview: null,
    subagents: [],
  });

const appState = (): AppState => ({
  ...initialState,
  hosts: [host],
  hostModels: {
    [HOST]: modelFromSnapshot({
      sequence: Sequence.make(1),
      workspaces: [
        new Workspace({
          id: workspaceId,
          path: "/code/polaris",
          name: "polaris",
          isGitRepo: true,
          worktreeRoot: "/code/polaris.worktrees",
          hidden: false,
          registeredAt: at(0),
        }),
      ],
      worktrees: [],
      sessions: [
        session("s1", "Spike GPUI review panes", "codex", 10),
        session("s2", "Polaris planning", "claude", 40),
      ],
    }),
  },
});

const availability = {
  harnesses: HARNESS_CATALOGUE.map((entry) => ({
    harness: entry.kind,
    status: entry.kind === "claude" || entry.kind === "codex" ? "ready" : "not-installed",
    version: entry.minVersion,
    minVersion: entry.minVersion,
    signInKind: null,
    detail: null,
    signInArgv: null,
  })),
  checkedAt: at(0),
};

const bridge: PolarisApi = {
  request: (method, input) => {
    if (method === "harness.models") {
      // SAFETY: harness.models' input always names a Harness; the preview only offers these two.
      const harness = (input as { harness: "claude" | "codex" }).harness;

      // SAFETY: the value is harness.models' output shape, which the method narrows to.
      return Promise.resolve({
        ok: true,
        value: { harness, models: MODELS[harness], switchesModel: true, fetchedAt: "" },
      } as never);
    }

    return Promise.resolve({ ok: false, error: { code: "Unsupported", message: "preview" } });
  },
  subscribe: (kind, _input, listener) => {
    if (kind === "harness.availability") {
      // SAFETY: an availability report is what the harness.availability feed carries.
      listener.items([availability] as never);
    }

    return () => undefined;
  },
  onAppEvent: () => () => undefined,
};

const SELECTED = { from: CODE.indexOf("  for (let"), to: CODE.indexOf('\n  return "offline"') };

const PROMPT = "Back off exponentially with some jitter, capped at 30 seconds";

const failing: Proposer = (_hostKey, _request, handlers) => {
  handlers.onFailed("Claude Code stopped: the selection's file couldn't be read");

  return () => undefined;
};

const PROPOSERS = {
  answer: scriptedProposer(
    () => ({
      summary: "It retries up to 8 times, waiting 500 ms longer each time, and gives up offline.",
      replacements: [],
    }),
    400
  ),
  failed: failing,
  thinking: scriptedProposer(() => PROPOSAL(CODE), 3_600_000),
} satisfies Record<string, Proposer>;

const isScripted = (scene: string): scene is keyof typeof PROPOSERS =>
  Object.hasOwn(PROPOSERS, scene);

const proposerFor = (scene: string): Proposer =>
  isScripted(scene)
    ? PROPOSERS[scene]
    : scriptedProposer((request) => PROPOSAL(request.content), 300);

const play = (view: EditorView, scene: string) => {
  view.dispatch({ selection: EditorSelection.range(SELECTED.from, SELECTED.to) });
  view.focus();

  if (scene === "selection") return;

  if (scene === "add") {
    addSelectionToSession(view.state, file);

    return;
  }

  openInlineCard(view);
  const card = cardOf(view.state);

  if (card === null) return;
  patchCard(card.id, () => ({ prompt: PROMPT, model: "opus" }));

  if (scene === "card") return;
  submitCard(view, card.id);

  if (scene === "stale")
    setTimeout(() => view.dispatch({ changes: { from: 0, insert: " " } }), 100);
};

const Editor = ({ scene }: { readonly scene: string }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current === null) return undefined;

    const view = new EditorView({
      doc: CODE,
      parent: ref.current,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        javascript({ typescript: true }),
        syntaxHighlighting(defaultHighlightStyle),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--color-bg)" },
          ".cm-content": {
            fontFamily: "var(--font-mono)",
            lineHeight: "20px",
            fontVariantLigatures: "none",
          },
          ".cm-gutters": {
            backgroundColor: "var(--color-bg)",
            border: "none",
            color: "var(--color-text-subtle)",
          },
        }),
        inlineExtensions(file),
      ],
    });

    setTimeout(() => play(view, scene), 50);

    return () => view.destroy();
  }, [scene]);

  return <div ref={ref} className="bg-bg h-full" data-testid="preview-editor" />;
};

export const mountEditorInlinePreview = (root: HTMLElement, hash: string) => {
  const scene = hash.replace(/^#editor-inline\//, "");
  const store = createStore<AppState>(appState);

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: (density) => store.setState({ density }),
    setAppearance: ({ density, theme }) => store.setState({ density, theme }),
  };

  const navigation = createNavigation({ app: store, storage: null });

  navigation.actions.selectWorkspace({ hostKey: HOST, workspaceId });
  navigation.actions.setMode("edit");
  standInBridge(bridge);
  setProposer(proposerFor(scene));
  cards.setState({});

  createRoot(root).render(
    <AppProvider value={{ connection, navigation, commands: createCommandRegistry({ mac: true }) }}>
      <TooltipProvider>
        <main className="bg-bg h-full">
          <Editor scene={scene} />
        </main>
        <InlineLayers />
        <Toaster />
      </TooltipProvider>
    </AppProvider>
  );

  return connection.setDensity;
};

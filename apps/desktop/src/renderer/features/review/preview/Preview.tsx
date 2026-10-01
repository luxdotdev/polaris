/**
 * Review on fixtures, for screenshots against Paper R1 / R2 (`scripts/reviewScreens.ts`)
 * and the large-Review bench: `#review/pull`, `#review/session`, `#review/large` (2,500
 * files, collapsed) and `#review/list-only` (12,000 files). A stand-in bridge serves the
 * patches; no Daemon or GitHub is involved. Its own chunk.
 */
import { type GitDiffSpec, ReviewCheckout } from "@polaris/protocol";
import { Predicate } from "effect";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import type { OpenPull, PolarisApi, Result } from "../../../../shared/api.ts";
import { App } from "../../../app/App.tsx";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { openPull, openSessionReview } from "../../../routes/review.ts";
import { emptyHostModel } from "../../../store/hostModel.ts";
import { type AppState, type Connection, initialState, sessionKey } from "../../../store/store.ts";
import { standInBridge } from "../../bridge.ts";
import { pullsStore } from "../../pulls/store.ts";
import { ACCOUNTS, HOSTS, LIST, MODELS } from "../../pulls/preview/fixtures.ts";
import {
  pullSummary,
  sessionSummary,
  setUpScene,
  withThreads,
} from "../../risk/preview/fixtures.ts";
import { subjectKey, updateSurface } from "../surface.ts";
import {
  CHECKOUT,
  manyFilesPatch,
  PULL_DETAIL,
  PULL_FINDINGS,
  PULL_PATCH,
  SESSION,
  SESSION_FINDINGS,
  sessionModel,
  TURN_PATCHES,
} from "./fixtures.ts";

const encode = (text: string) => new TextEncoder().encode(text);

const patchFor = (scene: string, spec: GitDiffSpec) => {
  if (scene === "large") return manyFilesPatch(2500);

  if (scene === "list-only") return manyFilesPatch(12_000);

  return Predicate.isTagged(spec, "Turn") ? (TURN_PATCHES.get(spec.turnId) ?? "") : PULL_PATCH;
};

/** What the stand-in reads of a request's input. */
interface PreviewInput {
  readonly spec?: GitDiffSpec;
}

const ok = <A,>(value: A): Promise<Result<A>> => Promise.resolve({ ok: true, value });

const request = (scene: string) => (method: string, input: PreviewInput) => {
  if (method === "git.diff" && input.spec !== undefined) {
    return ok({ bytes: encode(patchFor(scene, input.spec)), files: 0, fileIndex: [] });
  }

  if (method === "git.show" || method === "files.read") {
    return ok({ size: 0, mimeType: "text/plain", content: { kind: "text", text: "" } });
  }

  if (method === "github.pull.detail") {
    return ok(scene.startsWith("pull-") ? withThreads(PULL_DETAIL) : PULL_DETAIL);
  }

  if (method === "review.runRiskSummary") {
    return ok(
      scene.startsWith("session")
        ? sessionSummary(SESSION_FINDINGS, SESSION.id)
        : pullSummary(scene === "large" || scene === "list-only" ? [] : PULL_FINDINGS)
    );
  }

  if (method === "review.verdicts") return ok([]);

  if (method === "github.files.setViewed" || method === "dispatch") return ok(null);

  return Promise.resolve({ ok: false, error: { code: "Unsupported", message: "preview" } });
};

const bridge = (scene: string): PolarisApi => ({
  // SAFETY: the stand-in answers every method the Review view asks with its declared shape.
  request: request(scene) as PolarisApi["request"],
  subscribe: () => () => undefined,
  onAppEvent: () => () => undefined,
});

const PULL: OpenPull = {
  repo: { owner: "work-org", name: "nj-homes-choice-next" },
  number: 88,
  pullId: "PR_88",
};

/**
 * `#review/bench?cwd=…&base=…&head=…`: a real repository through the real Daemon on the
 * local Host, as a Review Checkout would serve it (`scripts/reviewBench.ts`).
 */
const benchModels = (query: URLSearchParams): AppState["hostModels"] => {
  const head = query.get("head") ?? "";
  const base = query.get("base") ?? "";

  const checkout = new ReviewCheckout({
    id: CHECKOUT.id,
    workspaceId: CHECKOUT.workspaceId,
    subject: CHECKOUT.subject,
    state: "ready",
    blocked: null,
    reviewedHead: null,
    reviewedMergeBase: null,
    openedAt: CHECKOUT.openedAt,
    updatedAt: CHECKOUT.updatedAt,
    path: query.get("cwd") ?? "",
    head,
    mergeBase: base,
    latestHead: head,
    latestBase: base,
  });

  return {
    local: {
      ...emptyHostModel,
      synchronized: true,
      reviewCheckouts: new Map([[checkout.id, checkout]]),
    },
  };
};

export const mountReviewPreview = (root: HTMLElement, hash: string) => {
  const [scene = "", search = ""] = hash.replace(/^#review\//, "").split("?");
  const bench = scene === "bench";
  const studio = MODELS.studio;
  const local = MODELS.local;

  const store = createStore<AppState>(() => ({
    ...initialState,
    hosts: bench ? [] : HOSTS,
    hostModels: bench
      ? benchModels(new URLSearchParams(search))
      : {
          ...MODELS,
          studio: { ...studio, reviewCheckouts: new Map([[CHECKOUT.id, CHECKOUT]]) },
          local: {
            ...local,
            sessions: new Map([
              [
                SESSION.id,
                { session: SESSION, pendingApprovals: [], lastTurnPreview: null, subagents: [] },
              ],
            ]),
          },
        },
    sessions: { [sessionKey("local", SESSION.id)]: sessionModel() },
  }));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: (density) => store.setState({ density }),
    setAppearance: ({ density, theme }) => store.setState({ density, theme }),
  };

  const navigation = createNavigation({ app: store, storage: null });

  if (!bench) {
    standInBridge(bridge(scene));
    pullsStore.setState({ list: LIST, accounts: ACCOUNTS });
  }

  setUpScene(scene, subjectKey({ kind: "session", hostKey: "local", sessionId: SESSION.id }));

  if (scene.startsWith("session")) {
    openSessionReview(navigation.actions, "local", SESSION.id);
    updateSurface(subjectKey({ kind: "session", hostKey: "local", sessionId: SESSION.id }), {
      findings: SESSION_FINDINGS,
      selectedFinding: SESSION_FINDINGS[0]?.id ?? null,
    });
  } else {
    openPull(navigation.actions, PULL);
    updateSurface(subjectKey({ kind: "pull", pull: PULL }), {
      findings: scene.startsWith("pull") ? PULL_FINDINGS : [],
      selectedFinding:
        scene === "pull" || scene === "pull-verdict" ? (PULL_FINDINGS[0]?.id ?? null) : null,
    });
  }

  const commands = createCommandRegistry({ mac: true });

  createRoot(root).render(<App value={{ connection, navigation, commands }} />);

  return connection.setDensity;
};

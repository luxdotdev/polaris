import "../../../test/dom.testing.ts";
// Loaded first, as the app does: SessionOutput alone enters the shell's import cycle mid-way.
import "../../../app/slots.tsx";
import {
  Actor,
  Comment,
  CommentAnchor,
  CommentId,
  GitDiffSpec,
  Sequence,
  SessionId,
  TurnId,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { TooltipProvider } from "@polaris/ui";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { hostModel, hostView } from "../../../routes/fixtures.testing.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { session as sessionFixture, turnWith } from "../../../store/fixtures.testing.ts";
import { asPlain } from "../../../store/plain.ts";
import type { SessionComment } from "../../../store/sessionComments.ts";
import type { SessionModel, TurnView } from "../../../store/sessionModel.ts";
import { type AppState, type Connection, initialState, sessionKey } from "../../../store/store.ts";
import { type FakeBridge, installFakeBridge } from "../../../test/bridge.testing.ts";
import { standInBridge } from "../../bridge.ts";
import type { ConnectionStatusView } from "../../../../shared/api.ts";
import { openForEdit, useOutputOpen } from "../output/open.ts";
import { showTurnDiff, uiKey } from "../state.ts";
import { SessionOutput } from "./SessionOutput.tsx";

afterEach(() => {
  cleanup();
  standInBridge(null);
});

const sessionId = SessionId.make("s1");

const t = (id: string) => TurnId.make(id);

const PATCH = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+new
`;

/** A finished Turn; `checkpoint` false for one the Daemon took no before-checkpoint for. */
const turnOf = (index: number, index0 = 0, checkpoint = true): TurnView => ({
  turn: turnWith({
    id: TurnId.make(`t${index}`),
    index: index + index0,
    status: "completed",
    checkpointBefore: checkpoint ? `refs/polaris/checkpoints/s1/t${index}/before` : null,
  }),
  items: [],
  live: new Map(),
  subagents: [],
});

const modelOf = (
  turns: ReadonlyArray<TurnView>,
  comments: ReadonlyArray<SessionComment> = []
): SessionModel => ({
  // SAFETY: any positive sequence stands for a synchronized feed here.
  sequence: 1 as SessionModel["sequence"],
  synchronized: true,
  session: { ...asPlain(sessionFixture), state: "idle" },
  turns,
  pendingApprovals: [],
  comments,
});

/** Output as the lane shows it: the panel only once it is open, as `OutputLane` does. */
const Output = ({ hostKey }: { readonly hostKey: string }) =>
  useOutputOpen(uiKey(hostKey, sessionId)) ? (
    <SessionOutput hostKey={hostKey} sessionId={sessionId} />
  ) : null;

/** The session's first Turn, as the Host's oldest page has it. */
const firstDetail = {
  turn: turnWith({ id: t("first"), index: 0, checkpointBefore: "refs/polaris/first/before" }),
  items: [],
  subagents: [],
};

/** A line Comment on `turnId`'s diff, line 3 of a.ts. */
const lineComment = (id: string, turnId: string): SessionComment =>
  asPlain(
    new Comment({
      id: CommentId.make(id),
      sessionId,
      anchor: CommentAnchor.cases.DiffLines.make({
        turnId: t(turnId),
        path: "a.ts",
        side: "new",
        start: 3,
        end: 3,
        code: "keep",
      }),
      body: "Why this?",
      author: Actor.cases.Client.make({}),
      createdAt: "2026-11-19T10:00:00.000Z",
    })
  );

let hosts = 0;

/** The session's Output with a Daemon whose session diff has a file and whose Turn diffs have none. */
const mount = (
  model: SessionModel,
  capabilities: ConnectionStatusView["capabilities"] = ["git.diff-turns", "session.turn-paging"]
) => {
  hosts += 1;
  const hostKey = `scope-host-${hosts}`;
  const bridge: FakeBridge = installFakeBridge();
  const bytes = (text: string) => new TextEncoder().encode(text);

  bridge.answer("git.diff", ({ spec }) => ({
    ok: true,
    value: {
      bytes: bytes(Predicate.isTagged(spec, "Turns") ? PATCH : ""),
      files: 0,
      fileIndex: [],
    },
  }));

  const view = hostView(hostKey);

  const store: StoreApi<AppState> = createStore<AppState>(() => ({
    ...initialState,
    hosts: [{ ...view, status: { ...view.status, capabilities } }],
    hostModels: { [hostKey]: hostModel([{ id: "w1", sessions: [{ id: "s1", state: "idle" }] }]) },
    sessions: { [sessionKey(hostKey, sessionId)]: model },
  }));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: () => undefined,
    setAppearance: () => undefined,
  };

  const screen = render(
    <AppProvider
      value={{
        connection,
        navigation: createNavigation({ app: store, storage: null }),
        commands: createCommandRegistry({ platform: "mac" }),
      }}
    >
      <TooltipProvider>
        <Output hostKey={hostKey} />
      </TooltipProvider>
    </AppProvider>
  );

  const update = (next: SessionModel) =>
    act(() => {
      store.setState((s) => ({
        sessions: { ...s.sessions, [sessionKey(hostKey, sessionId)]: next },
      }));
    });

  const key = uiKey(hostKey, sessionId);

  return { screen, update, bridge, key };
};

const settle = () =>
  act(async () => {
    await Bun.sleep(5);
  });

test("Output shows the whole session's diff by default", async () => {
  const { screen, bridge, key } = mount(modelOf([turnOf(0), turnOf(1)]));

  act(() => openForEdit(key));
  await settle();

  expect(bridge.sent("git.diff").at(-1)?.spec).toEqual(
    GitDiffSpec.cases.Turns.make({ sessionId, firstTurnId: t("t0"), lastTurnId: t("t1") })
  );
  expect(screen.getByTestId("diff-turn").textContent).toBe("All turns");
  expect(screen.getByText("· 1 file")).not.toBeNull();
});

test("the session scope starts at its first Turn when only later Turns are loaded", async () => {
  const { bridge, key } = mount(modelOf([turnOf(0, 20), turnOf(1, 20)]));

  bridge.answer("session.turns", () => ({
    ok: true,
    value: {
      turns: [firstDetail],
      sequence: Sequence.make(1),
      hasMore: false,
    },
  }));
  act(() => openForEdit(key));
  await settle();
  await settle();

  expect(bridge.sent("git.diff").at(-1)?.spec).toEqual(
    GitDiffSpec.cases.Turns.make({ sessionId, firstTurnId: t("first"), lastTurnId: t("t1") })
  );
});

test("an empty Turn keeps Output open and says so in one line", async () => {
  const { screen, update, key } = mount(modelOf([turnOf(0)]));

  act(() => openForEdit(key));
  update(modelOf([turnOf(0), turnOf(1)]));
  act(() => showTurnDiff(key, "t1"));
  await settle();

  expect(screen.getByTestId("session-output")).not.toBeNull();
  expect(screen.getByTestId("diff-turn").textContent).toBe("Turn 2");
  const line = screen.getByTestId("diff-empty");

  expect(line.textContent).toBe("This turn changed no files");
  // One compact line, not the pane's empty state with its sparkle tile.
  expect(line.querySelector("svg")).toBeNull();
});

test("a Daemon that diffs one Turn at a time keeps the latest Turn as the default", async () => {
  const { screen, bridge, key } = mount(modelOf([turnOf(0), turnOf(1)]), []);

  act(() => openForEdit(key));
  await settle();

  expect(bridge.sent("git.diff").at(-1)?.spec).toEqual(
    GitDiffSpec.cases.Turn.make({ sessionId, turnId: t("t1") })
  );
  expect(screen.getByTestId("diff-turn").textContent).toBe("Turn 2");
});

test("a failed first-Turn fetch says the scope is partial, and Retry finds the first Turn", async () => {
  const { screen, bridge, key } = mount(modelOf([turnOf(0, 20), turnOf(1, 20)]));

  bridge.refuse("session.turns", { code: "Unavailable", message: "Host offline" });
  act(() => openForEdit(key));
  await settle();
  await settle();

  expect(screen.getByTestId("scope-note").textContent).toContain("showing the loaded turns only");
  expect(bridge.sent("git.diff").at(-1)?.spec).toEqual(
    GitDiffSpec.cases.Turns.make({ sessionId, firstTurnId: t("t0"), lastTurnId: t("t1") })
  );

  bridge.answerOk("session.turns", {
    turns: [firstDetail],
    sequence: Sequence.make(1),
    hasMore: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await settle();
  await settle();

  expect(screen.queryByTestId("scope-note")).toBeNull();
  expect(bridge.sent("git.diff").at(-1)?.spec).toEqual(
    GitDiffSpec.cases.Turns.make({ sessionId, firstTurnId: t("first"), lastTurnId: t("t1") })
  );
});

test("the session scope starts at the earliest Turn with a checkpoint, and says so", async () => {
  const { screen, bridge, key } = mount(modelOf([turnOf(0, 0, false), turnOf(1), turnOf(2)]));

  act(() => openForEdit(key));
  await settle();

  expect(bridge.sent("git.diff").at(-1)?.spec).toEqual(
    GitDiffSpec.cases.Turns.make({ sessionId, firstTurnId: t("t1"), lastTurnId: t("t2") })
  );
  expect(screen.getByTestId("scope-note").textContent).toBe(
    "From turn 2: earlier turns have no checkpoint"
  );
  expect(screen.queryByText("No diff to show")).toBeNull();
});

test("the whole session places no earlier Turn's Comment, and links to its Turn", async () => {
  const comments = [lineComment("c1", "t0"), lineComment("c2", "t0"), lineComment("c3", "t1")];
  const { screen, key } = mount(modelOf([turnOf(0), turnOf(1)], comments));

  act(() => openForEdit(key));
  await settle();

  // Turn 2 may have inserted lines above Turn 1's line 3: only Turn 2's Comment is placed.
  expect(screen.getByTestId("comments-elsewhere").textContent).toContain(
    "2 comments on their turn only"
  );
  fireEvent.click(screen.getByRole("button", { name: "Turn 1" }));
  await settle();

  expect(screen.getByTestId("diff-turn").textContent).toBe("Turn 1");
  expect(screen.queryByTestId("comments-elsewhere")).toBeNull();
});

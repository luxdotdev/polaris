import "../../../test/dom.testing.ts";
// Loaded first, as the app does: SessionOutput alone enters the shell's import cycle mid-way.
import "../../../app/slots.tsx";
import {
  BackgroundTask,
  SessionId,
  Subagent,
  SubagentId,
  TurnId,
  TurnItem,
} from "@polaris/protocol";
import { TooltipProvider } from "@polaris/ui";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { hostModel, hostView } from "../../../routes/fixtures.testing.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { session as sessionFixture, turnWith } from "../../../store/fixtures.testing.ts";
import { asPlain, type SessionData } from "../../../store/plain.ts";
import type { SessionModel, SubagentView, TurnView } from "../../../store/sessionModel.ts";
import { type AppState, type Connection, initialState, sessionKey } from "../../../store/store.ts";
import { installFakeBridge } from "../../../test/bridge.testing.ts";
import { standInBridge } from "../../bridge.ts";
import { waitingFor } from "../model/background.ts";
import { subagentRoster } from "../model/subagents.ts";
import { openSubagent } from "../output/actions.ts";
import { useOutputOpen } from "../output/open.ts";
import { uiKey } from "../state.ts";
import { Waiting } from "./background.tsx";
import { ComposerStatus } from "./ComposerStatus.tsx";
import { SessionOutput } from "./SessionOutput.tsx";

afterEach(() => {
  cleanup();
  standInBridge(null);
});

const I = TurnItem.cases;

let hosts = 0;

const sessionId = SessionId.make("s1");

const message = (id: string, text: string) => I.AssistantMessage.make({ id, text });

const sub = (
  turn: number,
  id: string,
  title: string,
  status: "working" | "completed",
  items: ReadonlyArray<TurnItem> = []
): SubagentView => ({
  subagent: new Subagent({
    id: SubagentId.make(id),
    sessionId,
    turnId: TurnId.make(`t${turn}`),
    parentItemId: id,
    title,
    agent: "Explore",
    model: null,
    background: true,
    status,
    startedAt: "2026-10-01T00:00:00.000Z",
    endedAt: status === "working" ? null : "2026-10-01T00:00:30.000Z",
  }),
  items,
  live: new Map(),
});

const turnOf = (index: number, subagents: ReadonlyArray<SubagentView>): TurnView => ({
  turn: turnWith({ id: TurnId.make(`t${index}`), index, status: "completed" }),
  items: [],
  live: new Map(),
  subagents,
});

const idle: SessionData = { ...asPlain(sessionFixture), state: "idle" };

const modelOf = (turns: ReadonlyArray<TurnView>, session = idle): SessionModel => ({
  // SAFETY: any positive sequence stands for a synchronized feed here.
  sequence: 1 as SessionModel["sequence"],
  synchronized: true,
  session,
  turns,
  pendingApprovals: [],
});

/** Output as the lane shows it: the panel only once it is open, as `OutputLane` does. */
const Output = ({ hostKey }: { readonly hostKey: string }) =>
  useOutputOpen(uiKey(hostKey, sessionId)) ? (
    <SessionOutput hostKey={hostKey} sessionId={sessionId} />
  ) : null;

const mount = (model: SessionModel) => {
  hosts += 1;
  const hostKey = `subagent-host-${hosts}`;
  installFakeBridge().refuse("git.diff", { code: "NotFound", message: "No checkpoint" });
  const view = hostView(hostKey);

  const store: StoreApi<AppState> = createStore<AppState>(() => ({
    ...initialState,
    hosts: [{ ...view, status: { ...view.status, capabilities: ["session.subagents"] } }],
    hostModels: { [hostKey]: hostModel([{ id: "w1", sessions: [{ id: "s1", state: "idle" }] }]) },
    sessions: { [sessionKey(hostKey, sessionId)]: model },
  }));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: () => undefined,
    setAppearance: () => undefined,
  };

  const Status = () => {
    const current = store.getState().sessions[sessionKey(hostKey, sessionId)] ?? model;

    return (
      <ComposerStatus
        hostKey={hostKey}
        harness="claude"
        session={idle}
        roster={subagentRoster(current.turns)}
        onOpenSubagent={(id) => openSubagent({ hostKey, workspaceId: "w1" }, sessionId, id)}
        turnNumber={null}
      />
    );
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
        <Status />
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

  return { screen, update };
};

const searcher = sub(0, "a-search", "Search the store for dropped items", "working", [
  message("m1", "Reading sessionModel.ts"),
]);

const earlier = [turnOf(0, [searcher]), turnOf(1, [])];

/** Lets Changes' diff request answer once the tab is back on it. */
const settle = () =>
  act(async () => {
    await Bun.sleep(5);
  });

test("clicking a moon opens Output on that subagent's transcript", async () => {
  const { screen } = mount(modelOf(earlier));

  expect(screen.queryByTestId("subagent-pane")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Open Explore: Search the store/ }));

  const pane = screen.getByTestId("subagent-pane");
  expect(within(pane).getByText("Search the store for dropped items")).not.toBeNull();
  expect(within(pane).getByText("Reading sessionModel.ts")).not.toBeNull();
  expect(screen.getByTestId("output-tab-changes").getAttribute("aria-pressed")).toBe("false");

  fireEvent.click(screen.getByRole("button", { name: "Close subagent" }));
  await settle();
  expect(screen.queryByTestId("subagent-pane")).toBeNull();
  expect(screen.getByTestId("output-tab-changes").getAttribute("aria-pressed")).toBe("true");
});

test("the subagent's transcript shows new items as they arrive", () => {
  const { screen, update } = mount(modelOf(earlier));

  fireEvent.click(screen.getByRole("button", { name: /Open Explore: Search the store/ }));
  expect(screen.queryByText("Found the drop in TurnEnded")).toBeNull();

  const grown = {
    ...searcher,
    items: [...searcher.items, message("m2", "Found the drop in TurnEnded")],
  };

  update(modelOf([turnOf(0, [grown]), turnOf(1, [])]));

  expect(
    within(screen.getByTestId("subagent-pane")).getByText("Found the drop in TurnEnded")
  ).not.toBeNull();
});

test("Escape inside the subagent tab returns to Changes", async () => {
  const { screen } = mount(modelOf(earlier));

  fireEvent.click(screen.getByRole("button", { name: /Open Explore: Search the store/ }));
  fireEvent.keyDown(screen.getByTestId("subagent-pane-transcript"), { key: "Escape" });
  await settle();

  expect(screen.queryByTestId("subagent-pane")).toBeNull();
});

test("background subagents from earlier Turns count the same in the composer and Waiting on, without ended ones", () => {
  const turns = [
    turnOf(0, [
      sub(0, "a1", "Read the Codex driver", "working"),
      sub(0, "a2", "Read the OpenCode driver", "completed"),
    ]),
    turnOf(1, [sub(1, "a3", "Read the Pi driver", "working")]),
    turnOf(2, [sub(2, "a4", "Check the fixtures", "completed")]),
  ];

  // The Daemon's list still names the ended ones, as a stale level signal would.
  const stale: SessionData = {
    ...idle,
    backgroundTasks: ["a1", "a2", "a3", "a4"].map(
      (id) => new BackgroundTask({ id: `task-${id}`, kind: "subagent", description: id })
    ),
  };

  const model = modelOf(turns, stale);
  const { screen } = mount(model);
  const waiting = waitingFor(stale, subagentRoster(turns), true);

  const rows = render(
    <TooltipProvider>
      <Waiting waiting={waiting} harness="claude" onOpenSubagent={() => undefined} />
    </TooltipProvider>
  );

  expect(screen.getByTestId("composer-subagents").textContent).toContain("2 subagents");
  expect(rows.getByTestId("waiting").textContent).toBe("Waiting on 2 subagents");
  expect(screen.getAllByTestId("composer-moon")).toHaveLength(2);
});

import "../../../test/dom.testing.ts";
// Loaded first, as the app does: the rail alone enters the shell's import cycle mid-way.
import "../../../app/slots.tsx";
import { PullRequestRef, RepoRef, SessionId, TurnId } from "@polaris/protocol";
import { TooltipProvider } from "@polaris/ui";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { hostModel, hostView } from "../../../routes/fixtures.testing.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { session as sessionFixture, turnWith } from "../../../store/fixtures.testing.ts";
import { asPlain, type SessionData } from "../../../store/plain.ts";
import type { SessionModel, TurnView } from "../../../store/sessionModel.ts";
import { type AppState, type Connection, initialState, sessionKey } from "../../../store/store.ts";
import { installFakeBridge } from "../../../test/bridge.testing.ts";
import { standInBridge } from "../../bridge.ts";
import type { ConnectionStatusView } from "../../../../shared/api.ts";
import { SessionOutput } from "../ui/SessionOutput.tsx";
import { useOutputOpen } from "./open.ts";
import { OutputRail } from "./OutputRail.tsx";
import { uiKey } from "../state.ts";

afterEach(() => {
  cleanup();
  standInBridge(null);
});

const sessionId = SessionId.make("s1");

const turnOf = (index: number): TurnView => ({
  turn: turnWith({
    id: TurnId.make(`t${index}`),
    index,
    status: "completed",
    checkpointBefore: `refs/polaris/checkpoints/s1/t${index}/before`,
  }),
  items: [],
  live: new Map(),
  subagents: [],
});

/** `count` files, each with `lines` added lines. */
const patchOf = (count: number, lines = 3) =>
  Array.from({ length: count }, (_, i) => {
    const added = Array.from({ length: lines }, (__, l) => `+line ${l}`).join("\n");

    return `diff --git a/src/f${i}.ts b/src/f${i}.ts
--- a/src/f${i}.ts
+++ b/src/f${i}.ts
@@ -1 +1,${lines + 1} @@
 keep
${added}
`;
  }).join("");

const modelOf = (session: Partial<SessionData> = {}, turns = [turnOf(0)]): SessionModel => ({
  // SAFETY: any positive sequence stands for a synchronized feed here.
  sequence: 1 as SessionModel["sequence"],
  synchronized: true,
  session: { ...asPlain(sessionFixture), state: "idle", ...session },
  turns,
  pendingApprovals: [],
  comments: [],
});

/** The Output lane as `OutputLane` draws it: the rail while closed, else the panel. */
const Lane = ({ hostKey }: { readonly hostKey: string }) =>
  useOutputOpen(uiKey(hostKey, sessionId)) ? (
    <SessionOutput hostKey={hostKey} sessionId={sessionId} />
  ) : (
    <OutputRail hostKey={hostKey} sessionId={sessionId} />
  );

let hosts = 0;

interface MountOptions {
  readonly files?: number;
  readonly model?: SessionModel;
  readonly status?: Partial<ConnectionStatusView>;
}

const mount = ({ files = 3, model = modelOf(), status = {} }: MountOptions = {}) => {
  hosts += 1;
  const hostKey = `rail-host-${hosts}`;
  const bridge = installFakeBridge();
  const bytes = new TextEncoder().encode(patchOf(files));

  bridge.answer("git.diff", () => ({ ok: true, value: { bytes, files: 0, fileIndex: [] } }));
  bridge.answerOk("git.status", {
    branch: "lucas/eng-978-a-very-long-branch-name-that-cannot-fit",
    head: "abc",
    ahead: 3,
    behind: 0,
    entries: [],
  });

  const view = hostView(hostKey);
  const capabilities: ConnectionStatusView["capabilities"] = ["git.diff-turns"];

  const store: StoreApi<AppState> = createStore<AppState>(() => ({
    ...initialState,
    hosts: [{ ...view, status: { ...view.status, capabilities, ...status } }],
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
        <Lane hostKey={hostKey} />
      </TooltipProvider>
    </AppProvider>
  );

  return { screen, key: uiKey(hostKey, sessionId) };
};

const settle = () =>
  act(async () => {
    await Bun.sleep(5);
  });

const KEYS = ["offsetWidth", "offsetHeight", "clientHeight", "scrollHeight"] as const;

/** happy-dom has no layout: a 400px list of 28px rows, and the offsets the list scrolls to. */
const useLayout = () => {
  const saved = KEYS.map(
    (key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)] as const
  );

  const scrolled: number[] = [];
  const scrollTo = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTo");

  beforeAll(() => {
    for (const key of KEYS)
      Object.defineProperty(HTMLElement.prototype, key, {
        configurable: true,
        get(this: HTMLElement) {
          if (key === "offsetWidth") return 600;

          if (key === "scrollHeight") return 100_000;

          return this.hasAttribute("data-index") ? 28 : 400;
        },
      });
    Object.defineProperty(Element.prototype, "scrollTo", {
      configurable: true,
      value(this: Element, options?: ScrollToOptions) {
        if (this.getAttribute("data-testid") === "diff") scrolled.push(options?.top ?? 0);
      },
    });
  });

  afterAll(() => {
    for (const [key, descriptor] of saved)
      if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, key);
      else Object.defineProperty(HTMLElement.prototype, key, descriptor);

    if (scrollTo === undefined) Reflect.deleteProperty(Element.prototype, "scrollTo");
    else Object.defineProperty(Element.prototype, "scrollTo", scrollTo);
  });

  return scrolled;
};

const paths = (screen: ReturnType<typeof render>) =>
  screen.queryAllByTestId("rail-file").map((row) => row.getAttribute("title"));

describe("Changes", () => {
  test("lists every file when five or fewer changed, with no “and N more”", async () => {
    const { screen } = mount({ files: 5 });

    await settle();

    expect(paths(screen)).toEqual([0, 1, 2, 3, 4].map((i) => `src/f${i}.ts`));
    expect(screen.queryByTestId("rail-more")).toBeNull();
    expect(screen.getByTestId("output-rail-changes").textContent).toBe("5 files+15");
  });

  test.each([
    [6, "and 1 more"],
    [500, "and 495 more"],
  ])("%i files show the first five, then %p", async (files, more) => {
    const { screen } = mount({ files });

    await settle();

    expect(paths(screen)).toHaveLength(5);
    expect(screen.getByTestId("rail-more").textContent).toBe(more);
    expect(screen.getByTestId("output-rail-changes").textContent).toBe(
      `${files} files+${files * 3}`
    );
  });

  test("a session that changed nothing says so, with no counts", async () => {
    const { screen } = mount({ files: 0 });

    await settle();

    expect(screen.getByTestId("output-rail-changes").textContent).toBe("No changes yet");
    expect(paths(screen)).toEqual([]);
  });
});

describe("opening the panel from the rail", () => {
  const scrolled = useLayout();

  test("a file opens the whole session's Changes, scrolled to that file", async () => {
    const { screen } = mount({ files: 40 });

    await settle();
    scrolled.length = 0;
    const fifth = screen.getAllByTestId("rail-file")[4];

    if (fifth === undefined) throw new Error("the rail lists five files");
    fireEvent.click(fifth);
    await settle();

    expect(screen.queryByTestId("output-rail")).toBeNull();
    expect(screen.getByTestId("diff-turn").textContent).toBe("All turns");
    // Past the first four files' header and four lines each: the fifth file's header.
    expect(scrolled.at(-1)).toBeGreaterThan(4 * 5 * 28);
  });

  test("“and N more” opens Changes at the top", async () => {
    const { screen } = mount({ files: 40 });

    await settle();
    scrolled.length = 0;
    fireEvent.click(screen.getByTestId("rail-more"));
    await settle();

    expect(screen.getByTestId("diff")).not.toBeNull();
    expect(scrolled.filter((top) => top > 0)).toEqual([]);
  });
});

describe("Activity and Where", () => {
  test("a Reconnecting Host leads the rail and says when it was last seen", async () => {
    const { screen } = mount({ status: { state: "reconnecting", since: Date.now() - 18_000 } });

    await settle();

    expect(screen.getByTestId("rail-activity").textContent).toBe("Reconnecting");
    expect(screen.getByText(/· seen 18s ago$/)).not.toBeNull();
  });

  test("the branch shows how far it is ahead, and a linked pull request its number", async () => {
    const pullRequest = new PullRequestRef({
      repo: new RepoRef({ host: "github.com", owner: "lux", name: "polaris" }),
      number: 212,
    });

    const { screen } = mount({ model: modelOf({ pullRequest }) });

    await settle();
    const where = screen.getByRole("group", { name: "Where" });

    expect(where.textContent).toContain("↑3");
    expect(where.textContent).toContain("#212");
  });

  test("no pull request leaves its row out", async () => {
    const { screen } = mount();

    await settle();

    expect(screen.getByRole("group", { name: "Where" }).textContent).not.toContain("#");
  });
});

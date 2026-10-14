import "../../../test/dom.testing.ts";
import { HostId, HostInfo, ReviewCheckout, ReviewCheckoutId, WorkspaceId } from "@polaris/protocol";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { createStore } from "zustand/vanilla";
import type { HostView, OpenPull } from "../../../../shared/api.ts";
import { Commands, Subjects } from "../../../commands.ts";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { hostView } from "../../../routes/fixtures.testing.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { emptyHostModel, type HostModel } from "../../../store/hostModel.ts";
import {
  type AppState,
  type AppStore,
  type Connection,
  initialState,
} from "../../../store/store.ts";
import { type FakeBridge, installFakeBridge } from "../../../test/bridge.testing.ts";
import { pullDetail, pullList, pullRow } from "../../../test/github.testing.ts";
import { standInBridge } from "../../bridge.ts";
import { pullsStore } from "../../pulls/store.ts";
import { refreshPullDetail } from "../data/pullDetail.ts";
import { checkoutMemory, rememberHost } from "./store.ts";
import { useCheckout } from "./useCheckout.ts";

let pulls = 0;

let pull: OpenPull;

/** Details and reported heads are kept per pull request and checkout, so each test takes new ones. */
const nextPull = (): OpenPull => {
  pulls += 1;

  return { repo: { owner: "acme", name: "atlas" }, number: pulls, pullId: `PR_${pulls}` };
};

const checkout = (id: string, patch: Partial<ReviewCheckout> = {}) =>
  new ReviewCheckout({
    id: ReviewCheckoutId.make(`${id}-${pull.number}`),
    workspaceId: WorkspaceId.make("w1"),
    subject: Subjects.PullRequest({
      pullRequest: { repo: { host: "github.com", ...pull.repo }, number: pull.number },
      baseRef: "main",
    }),
    path: `/code/atlas.worktrees/.review/pr-${pull.number}`,
    state: "ready",
    blocked: null,
    head: "head1",
    mergeBase: "base1",
    latestHead: "head1",
    latestBase: "base1",
    reviewedHead: null,
    reviewedMergeBase: null,
    openedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...patch,
  });

const modelWith = (...checkouts: ReadonlyArray<ReviewCheckout>): HostModel => ({
  ...emptyHostModel,
  reviewCheckouts: new Map(checkouts.map((c) => [c.id, c])),
});

const host = (key: string, label: string, state: HostView["status"]["state"] = "connected") => {
  const view = hostView(key, state);

  return {
    ...view,
    label,
    status: {
      ...view.status,
      host: new HostInfo({
        hostId: HostId.make(key),
        hostname: key,
        platform: "linux-arm64",
        daemonVersion: "0.1.0",
        homeDir: `/home/${key}`,
        startedAt: "2026-10-01T00:00:00.000Z",
      }),
    },
  };
};

/** The PR list's row for the pull request, holding the Workspaces with its repository. */
const withPlaces = (...hostKeys: ReadonlyArray<string>) => {
  const workspaces = hostKeys.map((hostKey) => ({ hostKey, workspaceId: "w1" }));

  pullsStore.setState({ list: pullList([pullRow({ number: pull.number, workspaces })]) });
};

let app: AppStore;

let bridge: FakeBridge;

const render = async () => {
  const connection: Connection = {
    store: app,
    openSession: () => () => undefined,
    setDensity: () => undefined,
    setAppearance: () => undefined,
  };

  const value = {
    connection,
    navigation: createNavigation({ app, storage: null }),
    commands: createCommandRegistry({ platform: "mac" }),
  };

  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <AppProvider value={value}>{children}</AppProvider>
  );

  const hook = renderHook(() => useCheckout(pull), { wrapper });

  // The run command and the comparison answer after the first render.
  await act(async () => undefined);

  return hook;
};

beforeEach(() => {
  pull = nextPull();
  bridge = installFakeBridge();
  bridge.refuse("files.read", { code: "FileError", message: "no package.json" });
  bridge.refuse("files.stat", { code: "FileError", message: "missing" });
  bridge.refuse("github.pull.compare", { code: "GitHubError", message: "not now" });
  bridge.answerOk("github.pull.detail", pullDetail({ id: pull.pullId ?? "", number: pull.number }));
  app = createStore<AppState>(() => initialState);
});

afterEach(() => {
  cleanup();
  standInBridge(null);
  pullsStore.setState(pullsStore.getInitialState());
  checkoutMemory.setState({ lastHost: {} });
});

describe("the checkout the chip speaks for", () => {
  test("the newest checkout, named by its Host's label", async () => {
    app.setState({
      hosts: [host("h1", "Studio"), host("h2", "Pi")],
      hostModels: {
        h1: modelWith(checkout("c1")),
        h2: modelWith(checkout("c2", { updatedAt: "2026-10-02T00:00:00.000Z" })),
      },
    });

    const { result } = await render();

    expect(result.current.held).toMatchObject({ hostKey: "h2", hostLabel: "Pi" });
    expect(result.current.home).toBe("/home/h2");
  });

  test("the repository's last used Host wins over a newer checkout elsewhere", async () => {
    rememberHost("acme/atlas", "h1");
    app.setState({
      hosts: [host("h1", "Studio"), host("h2", "Pi")],
      hostModels: {
        h1: modelWith(checkout("c1")),
        h2: modelWith(checkout("c2", { updatedAt: "2026-10-02T00:00:00.000Z" })),
      },
    });

    const { result } = await render();

    expect(result.current.held).toMatchObject({ hostKey: "h1", hostLabel: "Studio" });
  });

  test("none anywhere: nothing is held", async () => {
    app.setState({ hosts: [host("h1", "Studio")], hostModels: { h1: modelWith() } });

    const { result } = await render();

    expect(result.current.held).toBeNull();
    expect(result.current.home).toBeNull();
  });
});

describe("other places", () => {
  test("the next place is the first connected Host other than the held checkout's", async () => {
    withPlaces("h1", "h2", "h3");
    app.setState({
      hosts: [host("h1", "Studio"), host("h2", "Pi", "reconnecting"), host("h3", "VM")],
      hostModels: { h1: modelWith(checkout("c1")) },
    });

    const { result } = await render();

    expect(result.current.nextPlace).toEqual({ hostKey: "h3", workspaceId: "w1" });
  });

  test("only connected Hosts can be cloned on", async () => {
    app.setState({
      hosts: [host("h1", "Studio"), host("h2", "Pi", "offline")],
      hostModels: {},
    });

    const { result } = await render();

    expect(result.current.cloneTargets).toEqual([
      { hostKey: "h1", label: "Studio", homeDir: "/home/h1" },
    ]);
  });
});

describe("GitHub's head reaches the Host", () => {
  const detailWith = (head: string) => {
    bridge.answerOk(
      "github.pull.detail",
      pullDetail({ id: pull.pullId ?? "", number: pull.number, headRefOid: head })
    );

    return act(() => refreshPullDetail(pull));
  };

  const reported = () => bridge.sent("dispatch").map(({ command }) => command);

  test("a newer head than the checkout knows is reported once", async () => {
    app.setState({ hosts: [host("h1", "Studio")], hostModels: { h1: modelWith(checkout("c1")) } });
    await render();

    await detailWith("head2");
    await detailWith("head2");

    expect(reported()).toEqual([
      Commands.ReportReviewHead({ checkoutId: checkout("c1").id, head: "head2", base: "base1" }),
    ]);
  });

  test.each([
    { name: "the head it already knows", state: "ready", head: "head1" },
    { name: "a checkout still fetching", state: "fetching", head: "head2" },
  ] as const)("nothing is reported for $name", async ({ state, head }) => {
    app.setState({
      hosts: [host("h1", "Studio")],
      hostModels: { h1: modelWith(checkout("c1", { state })) },
    });
    await render();

    await detailWith(head);

    expect(reported()).toEqual([]);
  });

  test("once the checkout moves to a new head, GitHub's detail is fetched again", async () => {
    app.setState({ hosts: [host("h1", "Studio")], hostModels: { h1: modelWith(checkout("c1")) } });
    await render();
    const before = bridge.sent("github.pull.detail").length;

    act(() => {
      app.setState({ hostModels: { h1: modelWith(checkout("c1", { head: "head2" })) } });
    });

    await waitFor(() => expect(bridge.sent("github.pull.detail")).toHaveLength(before + 1));
    expect(bridge.sent("github.pull.detail").at(-1)).toEqual({
      pull: { repo: pull.repo, number: pull.number },
      refresh: true,
    });
  });
});

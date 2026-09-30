import { describe, expect, test } from "bun:test";
import { type Command, HostId, HostInfo, Workspace, WorkspaceId } from "@polaris/protocol";
import { createStore } from "zustand/vanilla";
import type { HostView, PolarisApi } from "../../../shared/api.ts";
import { Commands } from "../../commands.ts";
import { hostModel, hostView } from "../../routes/fixtures.testing.ts";
import type { HostModel } from "../../store/hostModel.ts";
import { type AppState, initialState } from "../../store/store.ts";
import { createEnsureWorkspace, HOME_WORKSPACE } from "./ensureWorkspace.ts";

const HOME = "/Users/ada";

const connected = (): HostView => {
  const view = hostView("local");

  return {
    ...view,
    status: {
      ...view.status,
      host: new HostInfo({
        hostId: HostId.make("h1"),
        hostname: "studio",
        platform: "darwin-arm64",
        daemonVersion: "0.1.0",
        homeDir: HOME,
        startedAt: "2026-09-30T00:00:00.000Z",
      }),
    },
  };
};

const withWorkspace = (model: HostModel, workspace: Workspace): HostModel => ({
  ...model,
  workspaces: new Map([...model.workspaces, [workspace.id, workspace]]),
});

const homeWorkspace = (hidden: boolean) =>
  new Workspace({
    id: WorkspaceId.make("ws_home"),
    path: HOME,
    name: HOME_WORKSPACE,
    isGitRepo: false,
    worktreeRoot: `${HOME}.worktrees`,
    hidden,
    registeredAt: "2026-09-30T00:00:00.000Z",
  });

/** A store for one Host and a Daemon that applies RegisterWorkspace / SetWorkspaceHidden. */
const setup = (model: HostModel, host: HostView = connected(), refuse = false) => {
  const store = createStore<AppState>(() => ({
    ...initialState,
    hosts: [host],
    hostModels: { local: model },
  }));

  const sent: Array<Command> = [];

  // Either command leaves a shown home Workspace.
  const apply = () => {
    const current = store.getState().hostModels.local ?? model;

    store.setState({ hostModels: { local: withWorkspace(current, homeWorkspace(false)) } });
  };

  const api: Pick<PolarisApi, "request"> = {
    request: (method, input) => {
      if (method !== "dispatch" || !("command" in input)) throw new Error(`unexpected ${method}`);
      sent.push(input.command);

      if (refuse) {
        return Promise.resolve({
          ok: false,
          error: { code: "CommandRejected", message: `${HOME} is not a directory` },
        } as const);
      }

      setTimeout(apply, 5);

      // SAFETY: only "dispatch" reaches here, whose output is `{ sequence }`.
      return Promise.resolve({ ok: true, value: { sequence: 2 } } as never);
    },
  };

  return { store, sent, ensure: createEnsureWorkspace({ api, store, timeoutMs: 200 }) };
};

describe("ensureWorkspace", () => {
  test("no Workspace: registers the Host's home directory as 'home' and waits for it", async () => {
    const { ensure, sent } = setup(hostModel([]));

    expect(await ensure("local")).toEqual({ ok: true, workspaceId: WorkspaceId.make("ws_home") });
    expect(sent).toEqual([Commands.RegisterWorkspace({ path: HOME, name: "home" })]);
  });

  test("a hidden home Workspace is shown again rather than registered twice", async () => {
    const { ensure, sent } = setup(withWorkspace(hostModel([]), homeWorkspace(true)));

    expect(await ensure("local")).toMatchObject({ ok: true });
    expect(sent).toEqual([
      Commands.SetWorkspaceHidden({ workspaceId: WorkspaceId.make("ws_home"), hidden: false }),
    ]);
  });

  test("a Host with a Workspace keeps it and sends nothing", async () => {
    const { ensure, sent } = setup(hostModel([{ id: "polaris" }]));

    expect(await ensure("local")).toEqual({ ok: true, workspaceId: WorkspaceId.make("polaris") });
    expect(sent).toHaveLength(0);
  });

  test("a Host that isn't connected can't say where home is", async () => {
    const { ensure, sent } = setup(hostModel([]), hostView("local", "offline"));

    expect(await ensure("local")).toEqual({ ok: false, reason: "local isn't connected" });
    expect(sent).toHaveLength(0);
  });

  test("the Daemon's refusal is the reason", async () => {
    const { ensure } = setup(hostModel([]), connected(), true);

    expect(await ensure("local")).toEqual({ ok: false, reason: `${HOME} is not a directory` });
  });

  test("two presses at once register once", async () => {
    const { ensure, sent } = setup(hostModel([]));
    const [a, b] = await Promise.all([ensure("local"), ensure("local")]);

    expect(a).toEqual(b);
    expect(sent).toHaveLength(1);
  });
});

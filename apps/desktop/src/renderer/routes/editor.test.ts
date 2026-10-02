import { describe, expect, test } from "bun:test";
import { WorkspaceId, Worktree, WorktreeId } from "@polaris/protocol";
import type { HostModel } from "../store/hostModel.ts";
import {
  editorRequest,
  editorRoute,
  openInEditor,
  parseLocation,
  resolvePath,
  workspaceFor,
} from "./editor.ts";
import { hostModel } from "./fixtures.testing.ts";

const withWorktree = (model: HostModel, workspace: string, path: string): HostModel => ({
  ...model,
  worktrees: new Map([
    [
      "wt",
      new Worktree({
        id: WorktreeId.make("wt"),
        workspaceId: WorkspaceId.make(workspace),
        path,
        branch: "feature",
        head: "abc",
        createdBySessionId: null,
        isMain: false,
      }),
    ],
  ]),
});

const model = withWorktree(
  hostModel([{ id: "polaris" }, { id: "polaris/apps" }, { id: "sightline" }]),
  "sightline",
  "/code/sightline.worktrees/feature"
);

const app = { hostModels: { local: model } };

describe("resolvePath", () => {
  test("joins a relative path to its root and folds dots", () => {
    expect(resolvePath("src/./a/../b.ts", "/code/polaris/")).toBe("/code/polaris/src/b.ts");
  });

  test("keeps an absolute path", () => {
    expect(resolvePath("/etc/hosts", "/code")).toBe("/etc/hosts");
  });

  test("stays relative with no root", () => {
    expect(resolvePath("src/a.ts", null)).toBe("src/a.ts");
  });
});

describe("workspaceFor", () => {
  test("picks the deepest Workspace holding the path", () => {
    expect(workspaceFor(model, "/code/polaris/apps/x.ts")).toBe(WorkspaceId.make("polaris/apps"));
    expect(workspaceFor(model, "/code/polaris/README.md")).toBe(WorkspaceId.make("polaris"));
  });

  test("a Worktree's file belongs to its Workspace", () => {
    expect(workspaceFor(model, "/code/sightline.worktrees/feature/a.ts")).toBe(
      WorkspaceId.make("sightline")
    );
  });

  test("a sibling with a shared prefix is not inside", () => {
    expect(workspaceFor(model, "/code/polaris-old/a.ts")).toBeNull();
  });
});

describe("editorRequest", () => {
  test("resolves the path and keeps 1-based positions", () => {
    expect(
      editorRequest(app, { hostKey: "local", path: "src/a.ts", root: "/code/polaris", line: 12 })
    ).toEqual({
      hostKey: "local",
      workspaceId: WorkspaceId.make("polaris"),
      path: "/code/polaris/src/a.ts",
      line: 12,
      column: null,
      folder: false,
    });
  });

  test("drops a line below 1", () => {
    expect(editorRequest(app, { hostKey: "local", path: "/code/polaris/a", line: 0 })?.line).toBe(
      null
    );
  });

  test("null outside every Workspace, or on an unknown Host", () => {
    expect(editorRequest(app, { hostKey: "local", path: "/tmp/a" })).toBeNull();
    expect(editorRequest(app, { hostKey: "pi", path: "/code/polaris/a" })).toBeNull();
  });

  test("an explicit Workspace wins", () => {
    expect(
      editorRequest(app, {
        hostKey: "local",
        path: "/tmp/a",
        workspaceId: WorkspaceId.make("sightline"),
      })?.workspaceId
    ).toBe(WorkspaceId.make("sightline"));
  });
});

describe("openInEditor", () => {
  const recorder = () => {
    const calls: Array<string> = [];

    return {
      calls,
      actions: {
        selectWorkspace: (t: { readonly workspaceId: string }) => calls.push(`ws:${t.workspaceId}`),
        setMode: (m: string) => calls.push(`mode:${m}`),
      },
    };
  };

  test("selects the Workspace, then Edit, with a fresh seq each time", () => {
    const { calls, actions } = recorder();
    const context = { app, actions, selected: { hostKey: "local", workspaceId: "sightline" } };

    expect(openInEditor(context, { hostKey: "local", path: "/code/polaris/a.ts", line: 3 })).toBe(
      true
    );
    const first = editorRoute.getState().request?.seq ?? 0;

    openInEditor(context, { hostKey: "local", path: "/code/polaris/a.ts", line: 3 });
    expect(editorRoute.getState().request?.seq).toBe(first + 1);
    expect(calls).toEqual(["ws:polaris", "mode:edit", "ws:polaris", "mode:edit"]);
  });

  test("keeps the selection when the Workspace is already selected", () => {
    const { calls, actions } = recorder();
    const context = { app, actions, selected: { hostKey: "local", workspaceId: "polaris" } };

    openInEditor(context, { hostKey: "local", path: "/code/polaris/a.ts" });
    expect(calls).toEqual(["mode:edit"]);
  });

  test("does nothing outside every Workspace", () => {
    const { calls, actions } = recorder();
    const context = { app, actions, selected: { hostKey: null, workspaceId: null } };

    expect(openInEditor(context, { hostKey: "local", path: "/tmp/a" })).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("parseLocation", () => {
  test("path, line and column", () => {
    expect(parseLocation("src/a.ts:12:4")).toEqual({ path: "src/a.ts", line: 12, column: 4 });
    expect(parseLocation("src/a.ts:12")).toEqual({ path: "src/a.ts", line: 12, column: null });
    expect(parseLocation("src/a.ts")).toEqual({ path: "src/a.ts", line: null, column: null });
  });
});

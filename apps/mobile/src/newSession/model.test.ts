import { describe, expect, test } from "bun:test";
import {
  decideDeviceAccess,
  SessionPlacement,
  Timestamp,
  Workspace,
  WorkspaceId,
} from "@polaris/protocol";
import {
  branchFromPrompt,
  defaultTarget,
  newSessionId,
  parsePermissionModes,
  permissionModeOn,
  permissionModesOn,
  type PermissionModes,
  routeLine,
  type SheetHost,
  startCommand,
  worktreeCaption,
} from "./model.ts";

const workspace = (id: string, path: string, hidden = false) =>
  Workspace.make({
    id: WorkspaceId.make(id),
    path,
    name: path.split("/").at(-1) ?? id,
    isGitRepo: true,
    worktreeRoot: `${path}.worktrees`,
    hidden,
    registeredAt: Timestamp.make("2026-10-01T00:00:00Z"),
  });

const host = (patch: Partial<SheetHost> & Pick<SheetHost, "hostId">): SheetHost => ({
  hostName: patch.hostId,
  connected: true,
  route: null,
  homeDir: "/Users/lucas",
  workspaces: [],
  sessions: [],
  capabilities: [],
  ...patch,
});

const studio = host({
  hostId: "studio",
  hostName: "Mac Studio",
  workspaces: [workspace("polaris", "/Users/lucas/code/polaris"), workspace("dcai", "/srv/dcai")],
  sessions: [
    { workspaceId: "dcai", harness: "codex", updatedAt: "2026-10-26T10:00:00Z" },
    { workspaceId: "polaris", harness: "claude", updatedAt: "2026-10-27T09:00:00Z" },
  ],
});

const vm = host({
  hostId: "vm",
  workspaces: [workspace("homes", "/home/lucas/nj-homes")],
  sessions: [{ workspaceId: "homes", harness: "claude", updatedAt: "2026-10-27T11:00:00Z" }],
});

describe("defaultTarget", () => {
  test("is the last used workspace across connected hosts, with its host", () => {
    expect(defaultTarget([studio, vm])).toEqual({ hostId: "vm", workspaceId: "homes" });
  });

  test("skips a host that isn't connected", () => {
    expect(defaultTarget([studio, { ...vm, connected: false }])).toEqual({
      hostId: "studio",
      workspaceId: "polaris",
    });
  });

  test("takes the workspace it was opened for over the last used one", () => {
    expect(defaultTarget([studio, vm], "dcai")).toEqual({ hostId: "studio", workspaceId: "dcai" });
  });

  test("never lands on a hidden workspace", () => {
    const hidden = {
      ...vm,
      workspaces: [workspace("homes", "/home/lucas/nj-homes", true)],
    };

    expect(defaultTarget([studio, hidden])).toEqual({ hostId: "studio", workspaceId: "polaris" });
  });

  test("falls back to the first workspace when nothing ran yet, and to none without one", () => {
    expect(defaultTarget([{ ...studio, sessions: [] }])).toEqual({
      hostId: "studio",
      workspaceId: "polaris",
    });
    expect(defaultTarget([host({ hostId: "empty" })])).toBeNull();
  });
});

test.each([
  ["relay", "Runs on Mac Studio · via Polaris Relay"],
  ["network", "Runs on Mac Studio · on this network"],
  [null, "Runs on Mac Studio"],
] as const)("the route line for %s", (route, line) => {
  expect(routeLine({ ...studio, route })).toBe(line);
});

const planning: SheetHost = { ...studio, capabilities: ["session.plan-mode"] };

test("the sheet offers the Desktop App's five modes, without Plan on a host that lacks it", () => {
  expect(permissionModesOn(planning).map((p) => [p.label, p.detail])).toEqual([
    ["Plan", "Reads and plans, asks before any edit"],
    ["Supervised", "Asks before edits and commands"],
    ["Auto edits", "Edits freely, asks before commands"],
    ["Auto", "Asks only for risky actions"],
    ["Full access", "Never asks"],
  ]);
  expect(permissionModesOn(studio).map((p) => p.mode)).toEqual([
    "supervised",
    "auto-edits",
    "auto",
    "full-access",
  ]);
});

test.each([
  [planning, undefined, "plan"],
  [studio, undefined, "supervised"],
  [planning, "full-access", "full-access"],
  [studio, "auto", "auto"],
  [studio, "plan", "supervised"],
] as const)("a host opens on its last mode or Plan (%#)", (host, remembered, mode) => {
  expect(permissionModeOn(host, remembered)).toBe(mode);
});

test.each<[string | null, PermissionModes]>([
  ['{"studio":"full-access","vm":"plan"}', { studio: "full-access", vm: "plan" }],
  [null, {}],
  ["not json", {}],
  ['{"studio":"yolo"}', {}],
])("the remembered modes read from %p", (text, modes) => {
  expect(parsePermissionModes(text)).toEqual(modes);
});

test("the worktree caption shows the path under home, or the branch it will take", () => {
  const polaris = workspace("polaris", "/Users/lucas/code/polaris");

  expect(worktreeCaption(false, polaris, "/Users/lucas", "")).toBe(
    "Off: runs in ~/code/polaris, in place"
  );
  expect(worktreeCaption(false, workspace("dcai", "/srv/dcai"), "/Users/lucas", "")).toBe(
    "Off: runs in /srv/dcai, in place"
  );
  expect(worktreeCaption(true, polaris, "/Users/lucas", "polaris/fix-it-3f9a")).toBe(
    "On: works on polaris/fix-it-3f9a"
  );
});

describe("startCommand", () => {
  const base = {
    sessionId: newSessionId(),
    workspaceId: WorkspaceId.make("polaris"),
    harness: "claude",
    model: "claude-opus-5-5",
    prompt: "  Sketch how the relay could resume a dropped phone connection.  ",
    permissionMode: "supervised" as const,
    capabilities: [],
  };

  test.each([
    ["plan", ["session.plan-mode"], "plan"],
    ["plan", [], "supervised"],
    ["supervised", ["session.plan-mode"], "supervised"],
    ["auto-edits", [], "auto-edits"],
    ["auto", [], "auto"],
    ["full-access", ["session.plan-mode"], "full-access"],
  ] as const)("%p on a host with %p starts %p", (permissionMode, capabilities, mode) => {
    expect(
      startCommand({ ...base, permissionMode, capabilities, newWorktree: false })
    ).toMatchObject({ permissionMode: mode });
  });

  test("starts in place, supervised, with the trimmed prompt and the picked model", () => {
    expect(startCommand({ ...base, newWorktree: false })).toMatchObject({
      placement: SessionPlacement.cases.InPlace.make({}),
      permissionMode: "supervised",
      model: "claude-opus-5-5",
      prompt: "Sketch how the relay could resume a dropped phone connection.",
    });
  });

  test("a new worktree takes a branch from the prompt and the session's id", () => {
    const command = startCommand({ ...base, model: null, newWorktree: true });

    expect(command).toMatchObject({
      model: null,
      placement: SessionPlacement.cases.NewWorktree.make({
        branch: `polaris/sketch-how-the-relay-could-${base.sessionId.slice(0, 4)}`,
        baseRef: null,
      }),
    });
  });

  // RX3-1, ENG-458: a Linked Device's gate admits every StartSession the sheet can send.
  test.each(
    (["plan", "supervised", "auto-edits", "auto", "full-access"] as const).flatMap((mode) => [
      [mode, true] as const,
      [mode, false] as const,
    ])
  )(
    "the Host admits Start from a Linked Device: %p, new worktree %p",
    (permissionMode, newWorktree) => {
      const command = startCommand({
        ...base,
        permissionMode,
        newWorktree,
        capabilities: ["session.plan-mode"],
      });

      expect(decideDeviceAccess("dispatch", command._tag, command)).toBeNull();
    }
  );

  test("two sessions with the same prompt never share a branch", () => {
    expect(branchFromPrompt(base.prompt, newSessionId())).not.toBe(
      branchFromPrompt(base.prompt, newSessionId())
    );
  });
});

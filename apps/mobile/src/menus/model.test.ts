import { describe, expect, test } from "bun:test";
import {
  ApprovalDecision,
  type ApprovalRequest,
  Command,
  decideDeviceAccess,
  RequestId,
  SessionId,
} from "@polaris/protocol";
import type { ConstellationRow, SessionRow } from "../home/model/home.ts";
import { commandApproval, constellation, question, session } from "../home/fixtures.testing.ts";
import { commandOf, constellationMenu, hostMenu, type Menu, sessionMenu } from "./model.ts";

const row = (
  input: Parameters<typeof session>[0],
  approval: ApprovalRequest | null = null,
  stale = false
): SessionRow => ({
  kind: "session",
  key: `mac/${input.id}`,
  hostId: "mac",
  hostName: "Mac Studio",
  workspaceName: "polaris",
  session: session(input),
  approval,
  replyPreview: null,
  since: 0,
  stale,
});

const constellationRow = (
  lead: ReturnType<typeof session> | null,
  state: ConstellationRow["constellation"]["state"] = "running"
): ConstellationRow => ({
  kind: "constellation",
  key: "mac/c1",
  hostId: "mac",
  hostName: "Mac Studio",
  constellation: constellation("c1", "lead", "w1", state),
  lead,
  since: 0,
  stale: false,
});

const titles = (menu: Menu) => menu.map((group) => group.map((item) => item.title));

const wantsBuild = commandApproval("s1", "r1", "cargo build --release");

describe("an agent session's menu", () => {
  test("a session with turns opens either way and copies its ID", () => {
    expect(titles(sessionMenu(row({ id: "s1", turnCount: 3 })))).toEqual([
      ["Open agent session", "Open review"],
      ["Pin to top", "Rename…", "Archive"],
      ["Copy agent session ID"],
    ]);
  });

  // ENG-491: the phone's Archive keeps the branch, so Unarchive undoes it.
  test("pins, unpins, archives without deleting the branch, and unarchives", () => {
    const commands = (input: Parameters<typeof session>[0]) =>
      sessionMenu(row(input))
        .flat()
        .flatMap((item) => {
          const command = commandOf(item.action);

          return command === null ? [] : [command];
        });

    expect(commands({ id: "s1" })).toEqual([
      Command.cases.PinSession.make({ sessionId: SessionId.make("s1"), pinned: true }),
      Command.cases.ArchiveSession.make({
        sessionId: SessionId.make("s1"),
        deleteMergedBranch: false,
      }),
    ]);
    expect(commands({ id: "s1", state: "archived", pinnedAt: "2026-10-28T00:00:00.000Z" })).toEqual(
      [
        Command.cases.PinSession.make({ sessionId: SessionId.make("s1"), pinned: false }),
        Command.cases.UnarchiveSession.make({ sessionId: SessionId.make("s1") }),
      ]
    );
  });

  test.each([
    ["no turns yet", { id: "s1", turnCount: 0 }],
    ["a reviewer's session", { id: "s1", title: "Reviewer · serve.ts" }],
  ])("%s has nothing to review", (_, input) => {
    expect(titles(sessionMenu(row(input)))[0]).toEqual(["Open agent session"]);
  });

  test("a permission request is answered from the menu, each with its own decision", () => {
    const menu = sessionMenu(row({ id: "s1", state: "needs-you" }, wantsBuild));
    const answers = menu[1] ?? [];

    const respond = (decision: ApprovalDecision) =>
      Command.cases.RespondToApproval.make({
        sessionId: SessionId.make("s1"),
        requestId: RequestId.make("r1"),
        decision,
      });

    expect(answers.map((item) => [item.title, commandOf(item.action)])).toEqual([
      ["Approve", respond(ApprovalDecision.cases.Allow.make({ remember: false }))],
      ["Always here", respond(ApprovalDecision.cases.Allow.make({ remember: true }))],
      ["Deny", respond(ApprovalDecision.cases.Deny.make({ reason: null }))],
    ]);
  });

  test("an offline host's answers are shown disabled, saying why", () => {
    const answers = sessionMenu(row({ id: "s1", state: "needs-you" }, wantsBuild, true))[1] ?? [];
    const offline = { disabled: true, subtitle: "Host offline" };

    expect(answers.map(({ disabled, subtitle }) => ({ disabled, subtitle }))).toEqual([
      offline,
      offline,
      offline,
    ]);
  });

  test.each([
    ["a question", question("s1", "r1", "Which branch?", ["main", "dev"])],
    ["a command too long to show", commandApproval("s1", "r1", "make\n".repeat(8))],
  ])("%s is never answered from the menu", (_, approval) => {
    const offered = sessionMenu(row({ id: "s1", state: "needs-you" }, approval)).flat();

    expect(offered.filter((item) => item.action.kind === "reply")).toEqual([]);
  });
});

describe("a constellation's menu", () => {
  test("opens the constellation, reviews and copies its lead", () => {
    const menu = constellationMenu(constellationRow(session({ id: "lead", turnCount: 2 })));

    expect(titles(menu)).toEqual([
      ["Open constellation", "Open review"],
      ["Pause", "Complete"],
      ["Copy agent session ID"],
    ]);
    expect(menu[2]?.[0]?.action).toEqual({ kind: "copy", text: "lead" });
  });

  // The Daemon's lifecycle: archive only once completed, nothing once archived.
  test.each<[ConstellationRow["constellation"]["state"], ReadonlyArray<string>]>([
    ["planning", []],
    ["running", ["Pause", "Complete"]],
    ["paused", ["Resume", "Complete"]],
    ["completed", ["Archive"]],
    ["archived", []],
  ])("a %s constellation offers %p", (state, offered) => {
    const items = constellationMenu(constellationRow(null, state)).flat();

    expect(
      items.filter((item) => item.action.kind === "set-state").map((item) => item.title)
    ).toEqual([...offered]);
  });
});

describe("a host's menu", () => {
  test("offers Retry now only while the host isn't connected", () => {
    expect(hostMenu({ hostId: "mac", state: "connected" })).toEqual([]);
    expect(titles(hostMenu({ hostId: "mac", state: "offline" }))).toEqual([["Retry now"]]);
  });
});

describe("every menu", () => {
  const menus: ReadonlyArray<Menu> = [
    sessionMenu(row({ id: "s1", state: "needs-you", turnCount: 2 }, wantsBuild)),
    constellationMenu(constellationRow(session({ id: "lead", turnCount: 2 }))),
    hostMenu({ hostId: "mac", state: "reconnecting" }),
  ];

  test("names each item once, so the native menu's choice runs the right one", () => {
    for (const menu of menus) {
      const ids = menu.flat().map((item) => item.id);

      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("sends only commands a linked device is granted", () => {
    const refused = menus
      .flat(2)
      .flatMap((item) => {
        const command = commandOf(item.action);

        return command === null ? [] : [decideDeviceAccess("dispatch", command._tag, command)];
      })
      .filter((refusal) => refusal !== null);

    expect(refused).toEqual([]);
  });
});

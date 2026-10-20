import { describe, expect, test } from "bun:test";
import { TurnId, TurnItem, type TurnStatus } from "@polaris/protocol";
import { turnWith } from "../../../store/fixtures.testing.ts";
import type { TurnView } from "../../../store/sessionModel.ts";
import { conversationRows } from "./conversation.ts";

const I = TurnItem.cases;

const shellTurn = (items: ReadonlyArray<TurnItem>, status: TurnStatus = "completed"): TurnView => ({
  turn: turnWith({
    id: TurnId.make("t0"),
    index: 0,
    prompt: "! bun test",
    shellCommand: "bun test",
    status,
  }),
  items,
  live: new Map(),
  subagents: [],
});

const ran = (origin: "user" | null) =>
  I.CommandExecution.make({
    id: origin === null ? "agent-run" : "shell:t0",
    command: "bun test",
    cwd: "/r",
    output: "1 fail",
    exitCode: 1,
    status: "failed",
    origin,
  });

const rowsOf = (view: TurnView) => conversationRows({ turns: [view], approvals: [] });

describe("a shell command in the conversation", () => {
  test("shows in the user's prompt with its output, not among the agent's rows", () => {
    const rows = rowsOf(
      shellTurn([ran("user"), I.AssistantMessage.make({ id: "m1", text: "One test fails" })])
    );

    const prompt = rows.find((r) => r.kind === "prompt");

    expect(prompt).toMatchObject({
      shell: { kind: "command", command: "bun test", output: "1 fail", exitCode: 1 },
    });
    expect(rows.filter((r) => r.kind === "item").map((r) => r.key)).toEqual(["t0:m1"]);
  });

  test("the agent's own run of the same command stays in the agent's rows", () => {
    const rows = rowsOf(shellTurn([ran("user"), ran(null)]));

    expect(rows.filter((r) => r.kind === "item").map((r) => r.key)).toEqual(["t0:agent-run"]);
  });

  test.each([
    ["working", { status: "running", live: true }],
    ["interrupted", { status: "failed", live: false }],
  ] as const)("before its output arrives, a %s Turn's command shows %o", (status, shown) => {
    const prompt = rowsOf(shellTurn([], status)).find((r) => r.kind === "prompt");

    expect(prompt).toMatchObject({ shell: { command: "bun test", output: "", ...shown } });
  });

  test("a prompt that isn't a shell command carries none", () => {
    const view = shellTurn([]);
    const plain = { ...view, turn: turnWith({ id: TurnId.make("t0"), prompt: "fix it" }) };

    expect(rowsOf(plain).find((r) => r.kind === "prompt")).toMatchObject({ shell: null });
  });
});

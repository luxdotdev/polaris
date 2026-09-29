import { describe, expect, test } from "bun:test";
import { ApprovalDecision, Attachment, AttachmentId, TurnItem } from "@polaris/protocol";
import { Schema } from "effect";
import {
  approvalDecision,
  elicitationDecision,
  permissionsDecision,
  policyFor,
  sandboxPolicyFor,
  toPlanItem,
  toTurnItem,
  turnInput,
  userInputDecision,
} from "./mapping.ts";
import { type Json, ThreadItem } from "./protocol.ts";

const item = (raw: Json) => toTurnItem(Schema.decodeUnknownSync(ThreadItem)(raw));

const { Allow, Answer, Deny } = ApprovalDecision.cases;

const attachment = (name: string, mimeType: string) =>
  new Attachment({
    id: AttachmentId.make(name),
    name,
    mimeType,
    size: 1,
    hostPath: `/home/user/.polaris/staging/s1/${name}`,
  });

describe("permission modes", () => {
  test("map onto approval policy, reviewer and sandbox", () => {
    expect(policyFor("supervised")).toEqual({
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandbox: "read-only",
    });
    expect(policyFor("auto-edits")).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
    });
    expect(policyFor("auto")).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
    });
    expect(policyFor("full-access")).toEqual({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "danger-full-access",
    });
  });

  test("sandbox modes expand to turn sandbox policies", () => {
    expect(sandboxPolicyFor("read-only")).toEqual({ type: "readOnly", networkAccess: false });
    expect(sandboxPolicyFor("workspace-write")).toMatchObject({ type: "workspaceWrite" });
    expect(sandboxPolicyFor("danger-full-access")).toEqual({ type: "dangerFullAccess" });
  });
});

describe("turn input", () => {
  test("images become localImage inputs; other files are mentioned by path", () => {
    const input = turnInput("look", [
      attachment("shot.png", "image/png"),
      attachment("notes.txt", "text/plain"),
    ]);

    expect(input).toEqual([
      {
        type: "text",
        text: "look\n\nAttached files:\n- /home/user/.polaris/staging/s1/notes.txt",
        text_elements: [],
      },
      { type: "localImage", path: "/home/user/.polaris/staging/s1/shot.png" },
    ]);
  });

  test("a plain prompt is one text input", () => {
    expect(turnInput("hi", [])).toEqual([{ type: "text", text: "hi", text_elements: [] }]);
  });
});

describe("thread items", () => {
  test("agent messages, reasoning and plans", () => {
    expect(item({ type: "agentMessage", id: "a", text: "ok", phase: null })).toEqual(
      TurnItem.cases.AssistantMessage.make({ id: "a", text: "ok" })
    );
    expect(item({ type: "reasoning", id: "r", summary: ["one", "two"], content: ["raw"] })).toEqual(
      TurnItem.cases.Reasoning.make({ id: "r", text: "one\n\ntwo" })
    );
    expect(item({ type: "reasoning", id: "r", summary: [], content: ["raw"] })).toMatchObject({
      text: "raw",
    });
  });

  test("command executions carry output, exit code and status", () => {
    expect(
      item({
        type: "commandExecution",
        id: "c",
        command: "ls",
        cwd: "/repo",
        status: "declined",
        aggregatedOutput: null,
        exitCode: null,
      })
    ).toEqual(
      TurnItem.cases.CommandExecution.make({
        id: "c",
        command: "ls",
        cwd: "/repo",
        output: "",
        exitCode: null,
        status: "declined",
      })
    );
  });

  test("file changes map update to modify", () => {
    expect(
      item({
        type: "fileChange",
        id: "f",
        status: "inProgress",
        changes: [
          { path: "a.ts", kind: { type: "add" }, diff: "" },
          { path: "b.ts", kind: { type: "update", move_path: null }, diff: "" },
          { path: "c.ts", kind: { type: "delete" }, diff: "" },
        ],
      })
    ).toEqual(
      TurnItem.cases.FileChange.make({
        id: "f",
        status: "running",
        changes: [
          { path: "a.ts", kind: "add" },
          { path: "b.ts", kind: "modify" },
          { path: "c.ts", kind: "delete" },
        ],
      })
    );
  });

  test("MCP tool calls become ToolCalls", () => {
    expect(
      item({
        type: "mcpToolCall",
        id: "t",
        server: "linear",
        tool: "get_issue",
        status: "completed",
        arguments: { id: "ENG-1" },
        result: { title: "x" },
        error: null,
      })
    ).toEqual(
      TurnItem.cases.ToolCall.make({
        id: "t",
        name: "linear.get_issue",
        input: { id: "ENG-1" },
        output: { title: "x" },
        status: "completed",
      })
    );
  });

  test("user messages and unknown items are skipped", () => {
    expect(item({ type: "userMessage", id: "u", content: [] })).toBeNull();
    expect(item({ type: "contextCompaction", id: "x" })).toBeNull();
    expect(item({ type: "somethingNew" })).toBeNull();
  });

  test("plan updates become a Plan item", () => {
    expect(
      toPlanItem("t1:plan", [
        { step: "read", status: "completed" },
        { step: "write", status: "inProgress" },
        { step: "test", status: "pending" },
      ])
    ).toEqual(
      TurnItem.cases.Plan.make({
        id: "t1:plan",
        steps: [
          { text: "read", status: "completed" },
          { text: "write", status: "in-progress" },
          { text: "test", status: "pending" },
        ],
      })
    );
  });
});

describe("approval decisions", () => {
  test("command and file-change approvals", () => {
    expect(approvalDecision(Allow.make({ remember: false }))).toEqual({ decision: "accept" });
    expect(approvalDecision(Allow.make({ remember: true }))).toEqual({
      decision: "acceptForSession",
    });
    expect(approvalDecision(Deny.make({ reason: null }))).toEqual({ decision: "decline" });
  });

  test("permission grants return only what was requested", () => {
    const requested = { network: { enabled: true }, fileSystem: null };
    expect(permissionsDecision(requested, Allow.make({ remember: true }))).toEqual({
      permissions: { network: { enabled: true } },
      scope: "session",
    });
    expect(permissionsDecision(requested, Deny.make({ reason: null }))).toEqual({
      permissions: {},
      scope: "turn",
    });
  });

  test("questions take the answer text, or the first option on Allow", () => {
    const questions = [
      {
        id: "q1",
        header: "DB",
        question: "Which?",
        options: [
          { label: "Postgres", description: "" },
          { label: "SQLite", description: "" },
        ],
      },
    ];

    expect(userInputDecision(questions, Answer.make({ text: "SQLite" }))).toEqual({
      answers: { q1: { answers: ["SQLite"] } },
    });
    expect(userInputDecision(questions, Allow.make({ remember: false }))).toEqual({
      answers: { q1: { answers: ["Postgres"] } },
    });
    expect(userInputDecision(questions, Deny.make({ reason: null }))).toEqual({ answers: {} });
  });

  test("MCP elicitations", () => {
    expect(elicitationDecision(Deny.make({ reason: null }))).toEqual({
      action: "decline",
      content: null,
      _meta: null,
    });
    expect(elicitationDecision(Allow.make({ remember: false }))).toMatchObject({
      action: "accept",
    });
  });
});

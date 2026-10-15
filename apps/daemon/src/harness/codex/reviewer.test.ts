import { afterEach, expect, test } from "bun:test";
import { ApprovalDecision, TurnId } from "@polaris/protocol";
import { Effect } from "effect";
import { makeCodexDriver } from "./CodexDriver.ts";
import { PROFILE_MIN_VERSION, REVIEWER_PROFILE } from "./confinement.ts";
import type { Handler } from "./testing/FakeAppServer.ts";
import { cleanup, ofTag, scripted, sessionWith, THREAD, turn } from "./testing/session.ts";

afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

const withSession = sessionWith(makeCodexDriver);

const children = ["standards_review", "spec_review"];

test("a new read-only thread opens without prompts even when its permission mode is full-access", async () => {
  const { server } = await withSession(
    scripted(() => {}),
    () => Effect.void,
    {
      readOnly: true,
      permissionMode: "full-access",
    }
  );

  const params = server.requests("thread/start")[0]?.params;

  // The legacy `read-only` sandbox reads the whole disk; the profile reads only the checkout.
  expect(params).toMatchObject({
    approvalPolicy: "never",
    config: {
      default_permissions: REVIEWER_PROFILE,
      permissions: {
        [REVIEWER_PROFILE]: {
          filesystem: { "/repo": "read", ":slash_tmp": "deny", ":tmpdir": "deny" },
        },
      },
      "shell_environment_policy.inherit": "core",
      "shell_environment_policy.set": { GIT_CONFIG_GLOBAL: "/dev/null" },
      // The user's MCP servers and plugins run outside the sandbox.
      mcp_servers: { linear: { enabled: false } },
      plugins: { "chrome@openai-bundled": { enabled: false } },
      "features.apps": false,
      "features.hooks": false,
      "features.memories": false,
      "features.browser_use": false,
      "features.computer_use": false,
      web_search: "disabled",
    },
  });
  expect(params).not.toHaveProperty("sandbox");
  expect(server.requests("config/read")[0]?.params).toMatchObject({ cwd: "/repo" });
});

test("a read-only thread doesn't start when Codex can't say which MCP servers it would run", async () => {
  const silent: Handler = (request, conn) =>
    request.method === "config/read"
      ? conn.replyError(-32601, "unknown method")
      : scripted(() => {})(request, conn);

  const failure = await withSession(silent, () => Effect.void, { readOnly: true }).then(
    () => null,
    String
  );

  expect(failure).toContain("Codex didn't say which tools the reviewer would have");
});

test("a read-only thread doesn't start on a Codex too old to hold it to the checkout", async () => {
  const old: Handler = (request, conn) =>
    request.method === "initialize"
      ? conn.reply({ userAgent: "polaris/0.158.0 (Mac OS 27.0.0; arm64)" })
      : scripted(() => {})(request, conn);

  const failure = await withSession(old, () => Effect.void, { readOnly: true }).then(
    () => null,
    String
  );

  expect(failure).toContain("Codex 0.158.0 can't keep the reviewer to its checkout");
  expect(failure).toContain(`Update Codex to ${PROFILE_MIN_VERSION} or later`);

  const plain = await withSession(old, () => Effect.void, {});
  expect(plain.server.requests("thread/start")[0]?.params).toMatchObject({ sandbox: "read-only" });
});

const activity = (child: string, kind: string) => ({
  threadId: THREAD,
  turnId: "t1",
  completedAtMs: 0,
  item: {
    type: "subAgentActivity",
    id: `${child}-${kind}`,
    kind,
    agentThreadId: child,
    agentPath: `/root/${child}`,
  },
});

// The devbox ordering: child approvals precede spawns; standards_review is stopped.
const recordedSequence = () => {
  let runs = 0;
  const answers: Array<unknown> = [];

  const handler = scripted(async (request, conn) => {
    if (request.method !== "turn/start") return;
    const id = `t${++runs}`;
    conn.reply({ turn: turn(id) });
    conn.notify("turn/started", { threadId: THREAD, turn: turn(id) });

    if (runs === 1) {
      for (const child of children) {
        conn.notify("turn/started", { threadId: child, turn: turn(`${child}-turn`) });
        answers.push(
          await conn.request("item/commandExecution/requestApproval", {
            threadId: child,
            turnId: `${child}-turn`,
            itemId: `${child}-command`,
            startedAtMs: 0,
            kind: "command",
            environmentId: null,
            command: "rg --files",
            cwd: "/repo",
            reason: null,
          })
        );
        conn.notify("item/completed", activity(child, "started"));
      }

      conn.notify("item/completed", activity("spec_review", "completed"));
      conn.notify("item/completed", activity("standards_review", "interrupted"));
    }

    conn.notify("item/completed", {
      threadId: THREAD,
      turnId: id,
      completedAtMs: 0,
      item: { type: "agentMessage", id: `${id}-final`, text: '{"findings":[]}' },
    });
    conn.notify("turn/completed", { threadId: THREAD, turn: turn(id, "completed") });
  });

  return { handler, answers };
};

test.each([false, true])(
  "Reviewer sequence completes with stopped Subagents and a follow-up (readOnly=%s)",
  async (readOnly) => {
    const recording = recordedSequence();
    const seen = new Set<string>();

    const { events, server } = await withSession(
      recording.handler,
      ({ session, waitFor }) =>
        Effect.gen(function* () {
          yield* session.sendTurn({
            turnId: TurnId.make("first"),
            prompt: "review",
            attachments: [],
            model: null,
            effort: null,
          });

          if (!readOnly) {
            for (let i = 0; i < children.length; i++) {
              const asked = yield* waitFor(
                "ApprovalRequested",
                (event) => event.title === "rg --files" && !seen.has(event.requestId)
              );

              seen.add(asked.requestId);
              yield* session.respond(
                asked.requestId,
                ApprovalDecision.cases.Allow.make({ remember: false })
              );
            }
          }

          yield* waitFor("TurnEnded");
          yield* session.setPermissionMode("full-access");
          yield* session.sendTurn({
            turnId: TurnId.make("second"),
            prompt: "Continue from where you left off.",
            attachments: [],
            model: null,
            effort: null,
          });
          yield* waitFor("TurnEnded", (event) => event.turnId === "second");
        }),
      { readOnly, resumeCursor: THREAD }
    );

    expect(ofTag(events, "TurnStarted").map((event) => event.turnId)).toEqual([
      TurnId.make("first"),
      TurnId.make("second"),
    ]);
    expect(ofTag(events, "TurnEnded").map((event) => event.status)).toEqual([
      "completed",
      "completed",
    ]);
    expect(ofTag(events, "SubagentStarted").map((event) => event.parentItemId)).toEqual(
      children.map((child) => `${child}-started`)
    );
    expect(ofTag(events, "SubagentEnded").map((event) => event.status)).toEqual([
      "completed",
      "interrupted",
    ]);
    expect(ofTag(events, "ItemCompleted").map((event) => event.item.id)).toEqual([
      "standards_review-started",
      "spec_review-started",
      "t1-final",
      "t2-final",
    ]);

    if (readOnly) {
      expect(ofTag(events, "ApprovalRequested")).toEqual([]);
      expect(recording.answers).toEqual([{ decision: "decline" }, { decision: "decline" }]);
      const resumed = server.requests("thread/resume")[0]?.params;
      expect(resumed).toMatchObject({
        approvalPolicy: "never",
        config: { default_permissions: REVIEWER_PROFILE },
      });
      expect(resumed).not.toHaveProperty("sandbox");

      // Even after a mode change, no Turn swaps the profile for a legacy policy.
      for (const request of server.requests("turn/start")) {
        expect(request.params).toMatchObject({ approvalPolicy: "never" });
        expect(request.params).not.toHaveProperty("sandboxPolicy");
      }
    }
  }
);

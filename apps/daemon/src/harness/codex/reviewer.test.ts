import { afterEach, expect, test } from "bun:test";
import { ApprovalDecision, TurnId } from "@polaris/protocol";
import { Effect } from "effect";
import { makeCodexDriver } from "./CodexDriver.ts";
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

  expect(server.requests("thread/start")[0]?.params).toMatchObject({
    approvalPolicy: "never",
    sandbox: "read-only",
  });
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
      expect(server.requests("thread/resume")[0]?.params).toMatchObject({
        approvalPolicy: "never",
        sandbox: "read-only",
      });

      for (const request of server.requests("turn/start"))
        expect(request.params).toMatchObject({
          approvalPolicy: "never",
          sandboxPolicy: { type: "readOnly", networkAccess: false },
        });
    }
  }
);

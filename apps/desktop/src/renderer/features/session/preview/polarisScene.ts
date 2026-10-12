/** Polaris's own tool calls, every tool and state (Paper "14 · Polaris tools"). */
import { TurnItem } from "@polaris/protocol";
import type { SessionModel } from "../../../store/sessionModel.ts";
import type { ToolInput } from "../model/items.ts";
import { model, session, turn, view } from "./fixtures.ts";

const I = TurnItem.cases;

type Status = "running" | "completed" | "failed" | "declined";

const recorded = (summary: string, revision: number) =>
  `${summary}\nRevision: ${revision}\nNext: Continue.`;

const refused = (code: string, message: string, fix: string, revision = 0) =>
  `${code}: ${message}\nFix: ${fix}\nRevision: ${revision}\nNext: Apply these fixes and retry; read status if the graph changed.`;

/** The banner the preview's notify call made, as main would record it. */
export const PREVIEW_NOTICE = {
  title: "B1 is ready for review",
  body: "Seven of eight properties hold; trace validation waits on B5.",
};

const CLAIM = `{"claim":{"branch":"polaris/b1-quint","head":"3f9c2e1a0b9d8c7e6f5a","commits":["a","b","c"],
  "receipts":[{"_tag":"Verified","label":"spec","item":{}},{"_tag":"Verified","label":"tests","item":{}},
    {"_tag":"Reported","label":"trace","text":"handover log fails","command":"bun run spec trace","exitCode":1}],
  "notDone":["Trace validation of the handover log"],"followups":[],
  "questions":[{"id":"q1","to":"lead","text":"Should the handover property wait for B5?","blocking":false}],
  "outsideArea":[{"path":"packages/spec/README.md","reason":"the property mapping"}],"decisions":[],
  "summary":"Seven of the eight properties hold and the simulator is clean. Trace validation fails on the handover log; that's B5's Task."}}`;

const PLAN = `{"operations":[
  {"_tag":"Add","task":{"id":"B6","title":"Lease bench and smoke","kind":"task","deps":["B2"],"area":["apps/daemon/src/bench/**"],"brief":""}},
  {"_tag":"Add","task":{"id":"G2","title":"Spec and tools merged","kind":"gate","deps":["B1","B6"],"brief":""}},
  {"_tag":"Edit","taskId":"A2","revision":1,"task":{"id":"A2","title":"Decider and projections","kind":"task","brief":""}},
  {"_tag":"Cancel","taskId":"A3","revision":1}]}`;

const TRANSCRIPT = [
  "Task B2 · Attempt a-b2",
  "# Lead and worker MCP tools",
  "",
  "## Turn 4 · completed · started 2026-10-11T13:52:00Z",
  "Prompt: Register the tools",
  "Assistant: The tools register; next is the idempotency key on mutating calls.",
  "$ bun test apps/daemon/src/mcp (exit 0)",
  "",
  "## Turn 5 · working · started 2026-10-11T14:06:00Z",
  "Prompt: Add requestId",
  "Assistant: Adding requestId to every mutating tool, then the retry window.",
  "$ bun run bench mcp --runs 3 (running)",
  "Next: Steer with message, or review its Claim when it arrives.",
].join("\n");

export const polarisTools = (): SessionModel => {
  const s = session("s-polaris", { title: "Constellations v1" });

  const call = (
    id: string,
    name: string,
    input: string,
    output: string | null,
    status: Status = "completed"
  ) =>
    I.ToolCall.make({
      id,
      name,
      // SAFETY: the Harness passes JSON; these literals are what Claude Code and Codex send.
      input: JSON.parse(input) as ToolInput,
      output,
      status,
    });

  return model({
    session: s,
    turns: [
      view(turn(s.id, 7, "Plan the spec round and start it", "completed"), [
        call("p1", "mcp__polaris__plan", PLAN, recorded("Plan recorded.", 8)),
        call(
          "p2",
          "mcp__polaris__dispatch",
          '{"tasks":[{"taskId":"B1","worker":{"host":"Mac Studio","selection":{"harness":"codex","model":"gpt-5.5"}}}]}',
          recorded("Dispatch recorded.", 9)
        ),
        call(
          "p3",
          "polaris.dispatch",
          '{"tasks":[{"taskId":"B2","worker":{"host":"Mac Studio","selection":{"harness":"claude","model":"opus-5"}}},{"taskId":"B3","worker":{"host":"devbox","selection":{"harness":"codex","model":"gpt-5.5"}}},{"taskId":"B4","worker":{"session":"mcp-http"}}]}',
          recorded("Dispatch recorded.", 9)
        ),
        call(
          "p4",
          "mcp__polaris__review",
          '{"task":"B3","revision":1,"action":{"_tag":"SendBack","reason":"The eval skips the dirty-Claim case; add it and rerun.","worker":{"session":"eval"}}}',
          recorded("Review recorded.", 10)
        ),
        call(
          "p5",
          "mcp__polaris__review",
          '{"task":"B1","revision":2,"action":{"_tag":"Accept","mergedHead":"3f9c2e1a0b9d8c7e6f5a","receipts":[{"_tag":"Verified","label":"spec","item":{}},{"_tag":"Verified","label":"tests","item":{}},{"_tag":"Reported","label":"smoke on Pi","text":"ran it"}]}}',
          recorded("Review recorded.", 11)
        ),
        call(
          "p6",
          "mcp__polaris__answer",
          '{"action":{"_tag":"Question","task":"B3","questionId":"q1","text":"Use devbox for now; rerun on the Pi once B2 releases the lock."}}',
          recorded("Answer recorded.", 12)
        ),
        call(
          "p7",
          "mcp__polaris__message",
          '{"to":"all","text":"Rebase on main before you claim; A2 landed."}',
          recorded("Message queued.", 12)
        ),
        call("p8", "mcp__polaris__status", "{}", recorded("Constellation status.", 12)),
        call("p9", "mcp__polaris__read_worker", '{"task":"B2","turns":2}', TRANSCRIPT),
        call(
          "p10",
          "mcp__polaris__review",
          '{"task":"B1","revision":1,"action":{"_tag":"Accept","mergedHead":"3f9c2e1","receipts":[]}}',
          refused("E-REVISION", "Attempt changed", "Read status and review the current Claim.", 12)
        ),
        call(
          "p11",
          "mcp__polaris__set_state",
          '{"action":{"_tag":"HandOver","summary":"A done and merged. B1 and B4 are in review; B3 waits on the bench lock.","interrupt":false,"selection":{"harness":"codex","model":"gpt-5.5"}}}',
          recorded("Constellation state action recorded.", 13)
        ),
        I.AssistantMessage.make({
          id: "m7",
          text: "B1 is accepted; B3 went back with the dirty-Claim case.",
        }),
      ]),
      view(turn(s.id, 8, "Claim B1", "working"), [
        call("w1", "mcp__polaris__claim", CLAIM, recorded("Claim recorded for review.", 10)),
        call(
          "w2",
          "mcp__polaris__progress",
          '{"note":"Rows at 32px in every density","completed":3,"total":5}',
          recorded("Progress recorded.", 10)
        ),
        call(
          "w3",
          "mcp__polaris__block",
          '{"on":["F1b"],"reason":"Needs the signed feed URL to poll"}',
          recorded("Attempt blocked; the Lead will hear why.", 10)
        ),
        call(
          "w4",
          "mcp__polaris__ask",
          '{"question":{"id":"q2","to":"user","text":"Can the endpoint change the wire format?","blocking":true}}',
          recorded("Question recorded.", 10)
        ),
        call(
          "w5",
          "mcp__polaris__propose",
          '{"task":{"id":"B7","title":"Lease bench and smoke","kind":"task","deps":["B2"],"area":["apps/daemon/src/bench/**"],"brief":"Hold the bench host with a lease so two evals never share it, and smoke-test the release on the Pi."}}',
          recorded("Proposal recorded.", 10)
        ),
        call(
          "w6",
          "polaris.wait_for_command",
          '{"task":"t1"}',
          "Finished: bun test (exit 0)\n… 212 earlier lines\n 1653 pass\n 0 fail\n 5222 expect() calls\nRan 1653 tests across 242 files. [15.32s]\nNext: Continue with the results."
        ),
        call(
          "w7",
          "polaris.wait_for_command",
          "{}",
          "Finished: bun run spec (exit 1)\nquint: property handover violated\nNext: Continue with the results."
        ),
        call(
          "w8",
          "polaris.wait_for_command",
          '{"timeoutSeconds":45}',
          "Still running after 45s:\n- t3: bun dev\nNext: Call wait_for_command again to keep waiting, or continue other work."
        ),
        call(
          "w9",
          "mcp__polaris__notify",
          JSON.stringify(PREVIEW_NOTICE),
          "Notification sent.\nNext: Continue."
        ),
        call(
          "w10",
          "mcp__polaris__notify",
          '{"title":"Tests pass"}',
          refused(
            "E-RATE",
            "This session notified the user moments ago",
            "Fold this into your next update, or notify again in 12s."
          )
        ),
        call("w11", "polaris.wait_for_command", '{"timeoutSeconds":45}', null, "running"),
      ]),
    ],
  });
};

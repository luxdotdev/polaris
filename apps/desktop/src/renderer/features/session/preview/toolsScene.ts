/**
 * The T-TOOLS scene: Skills, MCP calls and thinking folding into Tool Runs, a lone MCP call
 * with its result, a running one, and a failed one breaking out.
 */
import { type McpTool, type ToolKind, TurnItem } from "@polaris/protocol";
import type { SessionModel } from "../../../store/sessionModel.ts";
import type { ToolInput } from "../model/items.ts";
import { model, session, turn, view } from "./fixtures.ts";

const I = TurnItem.cases;

const call = (
  id: string,
  name: string,
  input: ToolInput,
  options: {
    readonly kind?: ToolKind;
    readonly mcp?: McpTool;
    readonly output?: ToolInput;
    readonly status?: "completed" | "failed" | "running";
  } = {}
) =>
  I.ToolCall.make({
    id,
    name,
    kind: options.kind ?? "other",
    mcp: options.mcp ?? null,
    input,
    output: options.output ?? null,
    status: options.status ?? "completed",
  });

const mcp = (
  id: string,
  server: string,
  tool: string,
  input: ToolInput,
  output: ToolInput = null
) => call(id, `mcp__${server}__${tool}`, input, { kind: "mcp", mcp: { server, tool }, output });

const FILE = "01M3JV1J857QNW61TGHZYR6GMZ";

/** T-TOOLS: the transcript from ENG-361's screenshot, as Tool Runs. */
export const tools = (): SessionModel => {
  const s = session("s-tools", { title: "Space invaders in the Command Palette" });

  return model({
    session: s,
    turns: [
      view(turn(s.id, 7, "Make the ship neutral, then file the Linear issue", "working"), [
        call("s1", "Skill", { skill: "grilling" }, { kind: "skill" }),
        call("s2", "Skill", { skill: "domain-modeling" }, { kind: "skill" }),
        I.AssistantMessage.make({
          id: "m1",
          text: "Updating G2 with a neutral ship, then I'll open the Linear issue and build.",
        }),
        I.CommandExecution.make({
          id: "c1",
          command: "cd /tmp/arcade && python3 gen.py",
          cwd: s.cwd,
          output: "wrote 12 sprites\n",
          exitCode: 0,
          status: "completed",
        }),
        mcp("p1", "paper", "write_html", {
          fileId: FILE,
          targetNodeId: "1TD3-0",
          mode: "replace",
          html: "<div layer-name='ship'></div>",
        }),
        mcp("p2", "paper", "write_html", { fileId: FILE, targetNodeId: "1TDD-0", mode: "replace" }),
        mcp("p3", "paper", "get_screenshot", { fileId: FILE, nodeId: "1TCW-0" }, [
          { type: "text", text: "Screenshot of G2 · ship" },
        ]),
        mcp("p4", "paper", "finish_working_on_nodes", { fileId: FILE, nodeIds: ["1SVS-0"] }),
        call("t1", "ToolSearch", { query: "select:mcp__claude_ai_Linear__save_issue,a,b" }),
        mcp("l1", "claude_ai_Linear", "get_workspace", {}),
        I.Reasoning.make({ id: "r1", text: "", startedAt: null, endedAt: null }),
        mcp(
          "l2",
          "claude_ai_Linear",
          "list_releases",
          {
            pipeline: "Polaris",
            stageType: "planned",
            limit: 10,
          },
          '[{"name":"Polaris 0.3.0"},{"name":"Polaris 0.2.0"}]'
        ),
        I.AssistantMessage.make({ id: "m2", text: "Filing it on 0.2.0." }),
        mcp(
          "l3",
          "claude_ai_Linear",
          "save_issue",
          { title: "Space invaders in the Command Palette", team: "ENG" },
          [{ type: "text", text: "Created ENG-363\nhttps://linear.app/luxdev/issue/ENG-363" }]
        ),
        call(
          "l4",
          "mcp__claude_ai_Linear__get_issue",
          { id: "ENG-999" },
          {
            kind: "mcp",
            mcp: { server: "claude_ai_Linear", tool: "get_issue" },
            output: "Issue ENG-999 not found",
            status: "failed",
          }
        ),
        call(
          "p5",
          "mcp__paper__get_screenshot",
          { fileId: FILE, nodeId: "1TCW-0" },
          { kind: "mcp", mcp: { server: "paper", tool: "get_screenshot" }, status: "running" }
        ),
      ]),
    ],
  });
};

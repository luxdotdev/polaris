/**
 * A bench Subagent, shaped like Claude Code's foreground one: an Agent tool
 * call starts it, it streams and completes its own report (items carrying its
 * `subagentId`), ends, and then the call completes with the report as output.
 */
import { SubagentId, type TurnId, TurnItem } from "@polaris/protocol";
import { Effect } from "effect";
import { HarnessEvent } from "../HarnessDriver.ts";

export const BENCH_SUBAGENT_REPORT = "Bench subagent report: all clear.";

export const runSubagent = Effect.fnUntraced(function* (
  emit: (event: HarnessEvent) => Effect.Effect<unknown>,
  turnId: TurnId,
  n: number
) {
  const callId = `${turnId}-agent-${n}`;
  const subagentId = SubagentId.make(callId);
  const input = { description: `Bench subagent ${n + 1}`, prompt: "Report back." };

  const call = (report: string | null) =>
    TurnItem.cases.ToolCall.make({
      id: callId,
      name: "Agent",
      input,
      output: report === null ? null : { content: [{ type: "text", text: report }] },
      status: report === null ? "running" : "completed",
    });

  yield* emit(HarnessEvent.ItemUpdated({ turnId, item: call(null) }));
  yield* emit(
    HarnessEvent.SubagentStarted({
      turnId,
      subagentId,
      parentItemId: callId,
      title: input.description,
      agent: "general-purpose",
      model: null,
    })
  );
  const reportId = `${callId}-report`;

  for (const word of BENCH_SUBAGENT_REPORT.split(/(?<= )/))
    yield* emit(
      HarnessEvent.ItemDelta({ turnId, itemId: reportId, field: "text", text: word, subagentId })
    );
  yield* emit(
    HarnessEvent.ItemCompleted({
      turnId,
      item: TurnItem.cases.AssistantMessage.make({ id: reportId, text: BENCH_SUBAGENT_REPORT }),
      subagentId,
    })
  );
  yield* emit(HarnessEvent.SubagentEnded({ subagentId, status: "completed" }));
  yield* emit(
    HarnessEvent.ItemCompleted({
      turnId,
      item: call(BENCH_SUBAGENT_REPORT),
    })
  );
});

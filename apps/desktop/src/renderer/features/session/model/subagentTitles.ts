/**
 * The session's Subagents by every handle a call may address them with (Claude Code's
 * SendMessage `to`, TaskStop's `task_id`): its id, the `name` its Agent call gave it, and the
 * agent id Claude Code returned. A native row naming one reads its title instead.
 */
import type { TurnItem } from "@polaris/protocol";
import { Option, Predicate, Schema } from "effect";
import type { SubagentView, TurnView } from "../../../store/sessionModel.ts";
import { type ItemView, withNativeCall } from "./items.ts";
import { withRecipient } from "./nativeTools/index.ts";
import { resultText } from "./subagents.ts";

type ToolCall = Extract<TurnItem, { readonly _tag: "ToolCall" }>;

const NonBlank = Schema.String.check(Schema.isPattern(/\S/));

const decodeName = Schema.decodeUnknownOption(Schema.Struct({ name: NonBlank }));

/** Claude Code's structured Agent result carries the agent id. */
const decodeAgentId = Schema.decodeUnknownOption(Schema.Struct({ agentId: NonBlank }));

/** Its text result says it too: "agentId: a157d0bd681b8ae6e (use SendMessage…". */
const AGENT_ID = /agentId: ([\w-]+)/;

const agentId = (output: ToolCall["output"]): string | null =>
  Option.match(decodeAgentId(output), {
    onSome: (o) => o.agentId,
    onNone: () => AGENT_ID.exec(resultText(output) ?? "")?.[1] ?? null,
  });

/** Every handle of one Subagent, given the call that spawned it. */
export const subagentHandles = (
  sub: SubagentView,
  call: ToolCall | undefined
): ReadonlyArray<string> => {
  const name =
    call === undefined ? null : Option.getOrNull(Option.map(decodeName(call.input), (i) => i.name));

  const id = call === undefined ? null : agentId(call.output);

  return [sub.subagent.id, name, id].filter(Predicate.isString);
};

const cache = new WeakMap<TurnView, ReadonlyArray<readonly [string, string]>>();

const turnHandles = (view: TurnView): ReadonlyArray<readonly [string, string]> => {
  const hit = cache.get(view);

  if (hit !== undefined) return hit;

  const calls = new Map(
    view.items.flatMap((i): Array<readonly [string, ToolCall]> =>
      Predicate.isTagged(i, "ToolCall") ? [[i.id, i]] : []
    )
  );

  const pairs = view.subagents.flatMap((sub) =>
    subagentHandles(sub, calls.get(sub.subagent.parentItemId ?? "")).map(
      (handle) => [handle, sub.subagent.title] as const
    )
  );

  cache.set(view, pairs);

  return pairs;
};

export interface SubagentTitles {
  /** Each handle of the session's Subagents, to its title. */
  readonly byHandle: ReadonlyMap<string, string>;
  /** Changes exactly when `byHandle` does: rows cached on it rebuild then. */
  readonly key: string;
}

export const noTitles: SubagentTitles = { byHandle: new Map(), key: "" };

export const subagentTitles = (turns: ReadonlyArray<TurnView>): SubagentTitles => {
  const pairs = turns.flatMap(turnHandles);

  return { byHandle: new Map(pairs), key: pairs.map((p) => p.join("=")).join("\n") };
};

/** A native row addressed to a Subagent, reading its title; any other item as it is. */
export const withSubagentTitle = (item: ItemView, titles: SubagentTitles): ItemView => {
  if (item.kind !== "tool" || item.native === null) return item;
  const named = withRecipient(item.native, titles.byHandle);

  return named === item.native ? item : withNativeCall(item, named);
};

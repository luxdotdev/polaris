/**
 * A Turn with its items, as Snapshots and pages of history send it, and
 * `session.turns`: older Turns of a session, a page at a time.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { Subagent, Turn, TurnItem } from "./domain.ts";
import { NotFound } from "./errors.ts";
import { Sequence, SessionId } from "./ids.ts";
import { addedArray } from "./models.ts";

/** A Subagent and its own items, viewable on its own. */
export class SubagentDetail extends Schema.Class<SubagentDetail>("SubagentDetail")({
  subagent: Subagent,
  items: Schema.Array(TurnItem),
}) {}

export class TurnDetail extends Schema.Class<TurnDetail>("TurnDetail")({
  turn: Turn,
  /** The Turn's own items, in completion order (`inStartOrder` places them); Subagents' are under `subagents`. */
  items: Schema.Array(TurnItem),
  /** The Subagents the Turn spawned, empty for Clients without `session.subagents`. */
  subagents: addedArray(SubagentDetail),
}) {}

/** Turns of a session, oldest first, as of `sequence`. */
export class TurnPage extends Schema.Class<TurnPage>("TurnPage")({
  turns: Schema.Array(TurnDetail),
  /** The store's sequence the page was read at; items committed later arrive on the session stream. */
  sequence: Sequence,
  /** True when Turns older than the first one here remain. */
  hasMore: Schema.Boolean,
}) {}

/**
 * Up to `limit` Turns with an index below `beforeIndex` (capability `session.turn-paging`),
 * for a Client that opened with `turnLimit` and scrolls back past its oldest Turn.
 */
export const ReadTurns = Rpc.make("session.turns", {
  payload: { sessionId: SessionId, beforeIndex: Schema.Int, limit: Schema.Int },
  success: TurnPage,
  error: NotFound,
});

export class SessionTurnRpcs extends RpcGroup.make(ReadTurns) {}

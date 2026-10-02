import type { Database } from "bun:sqlite";
import {
  LongContextTokens,
  ReportedCost,
  SessionId,
  TokenCounts,
  UsageBucket,
} from "@polaris/protocol";
import { Schema } from "effect";
import { LONG_CONTEXT_THRESHOLDS } from "./query.ts";

export interface UsageResponseQuery {
  readonly from: string;
  readonly to: string;
  readonly sessionIds: ReadonlyArray<SessionId>;
}

export interface UsageResponse {
  readonly id: number;
  readonly at: string;
  readonly bucket: UsageBucket;
}

export interface UsageResponses {
  readonly responses: ReadonlyArray<UsageResponse>;
  readonly indexedAt: string | null;
  readonly indexing: boolean;
}

const Row = Schema.Struct({
  id: Schema.Int,
  ts: Schema.Number,
  hour: Schema.Number,
  harness: Schema.String,
  model: Schema.String,
  session_id: Schema.String,
  input: Schema.Int,
  cache_read: Schema.Int,
  cache_write: Schema.Int,
  output: Schema.Int,
  reasoning: Schema.Int,
  cache_write_1h: Schema.Int,
  context: Schema.Int,
  cost: Schema.NullOr(Schema.Number),
});

const decode = Schema.decodeUnknownSync(Row);

/** Existing deduplicated response rows; no new index or telemetry recording. */
export const queryResponses = (
  db: Database,
  query: UsageResponseQuery
): ReadonlyArray<UsageResponse> => {
  if (query.sessionIds.length === 0) return [];
  const from = Date.parse(query.from);
  const to = Date.parse(query.to);
  const placeholders = query.sessionIds.map(() => "?").join(",");

  const rows = db
    .query<typeof Row.Type, (string | number)[]>(`
    SELECT u.*, m.session_id FROM usage u
    JOIN session_map m ON m.harness = u.harness AND m.native = u.native
    WHERE u.hour >= ? AND u.hour <= ? AND u.ts >= ? AND u.ts < ?
      AND m.session_id IN (${placeholders}) ORDER BY u.ts, u.id
  `)
    .all(Math.floor(from / 3600000) * 3600000, to, from, to, ...query.sessionIds);

  return rows.map((raw) => {
    const row = decode(raw);

    const tokens = TokenCounts.make({
      input: row.input,
      cacheRead: row.cache_read,
      cacheWrite: row.cache_write,
      output: row.output,
      reasoning: row.reasoning,
      cacheWrite1h: row.cache_write_1h,
    });

    return {
      id: row.id,
      at: new Date(row.ts).toISOString(),
      bucket: UsageBucket.make({
        hour: new Date(row.hour).toISOString(),
        harness: row.harness,
        model: row.model,
        sessionId: SessionId.make(row.session_id),
        tokens,
        reportedCost: row.cost === null ? null : ReportedCost.make({ tokens, usd: row.cost }),
        longContext: LONG_CONTEXT_THRESHOLDS.flatMap((above) =>
          row.context > above ? [LongContextTokens.make({ above, tokens })] : []
        ),
      }),
    };
  });
};

/**
 * Hourly buckets from the index: grouped by hour, Harness, Model and Agent
 * Session, where a Harness session id Polaris drove maps to its Agent Session.
 */
import type { Database } from "bun:sqlite";
import { ReportedCost, SessionId, TokenCounts, UsageBucket } from "@polaris/protocol";
import { hourOf } from "./writer.ts";

interface BucketRow {
  hour: number;
  harness: string;
  model: string;
  session_id: string | null;
  input: number;
  cache_read: number;
  cache_write: number;
  output: number;
  reasoning: number;
  cost: number | null;
  costed_input: number;
  costed_cache_read: number;
  costed_cache_write: number;
  costed_output: number;
  costed_reasoning: number;
}

const SELECT = `
SELECT u.hour AS hour, u.harness AS harness, u.model AS model, m.session_id AS session_id,
  SUM(u.input) AS input, SUM(u.cache_read) AS cache_read, SUM(u.cache_write) AS cache_write,
  SUM(u.output) AS output, SUM(u.reasoning) AS reasoning, SUM(u.cost) AS cost,
  SUM(CASE WHEN u.cost IS NULL THEN 0 ELSE u.input END) AS costed_input,
  SUM(CASE WHEN u.cost IS NULL THEN 0 ELSE u.cache_read END) AS costed_cache_read,
  SUM(CASE WHEN u.cost IS NULL THEN 0 ELSE u.cache_write END) AS costed_cache_write,
  SUM(CASE WHEN u.cost IS NULL THEN 0 ELSE u.output END) AS costed_output,
  SUM(CASE WHEN u.cost IS NULL THEN 0 ELSE u.reasoning END) AS costed_reasoning
FROM usage u LEFT JOIN session_map m ON m.harness = u.harness AND m.native = u.native`;

const GROUP =
  "GROUP BY u.hour, u.harness, u.model, m.session_id ORDER BY u.hour, u.harness, u.model";

const toBucket = (row: BucketRow): UsageBucket =>
  new UsageBucket({
    hour: new Date(row.hour).toISOString(),
    harness: row.harness,
    model: row.model,
    sessionId: row.session_id === null ? null : SessionId.make(row.session_id),
    tokens: new TokenCounts({
      input: row.input,
      cacheRead: row.cache_read,
      cacheWrite: row.cache_write,
      output: row.output,
      reasoning: row.reasoning,
    }),
    reportedCost:
      row.cost === null
        ? null
        : new ReportedCost({
            usd: row.cost,
            tokens: new TokenCounts({
              input: row.costed_input,
              cacheRead: row.costed_cache_read,
              cacheWrite: row.costed_cache_write,
              output: row.costed_output,
              reasoning: row.costed_reasoning,
            }),
          }),
  });

/** A type alias, not an interface: bun:sqlite's bindings need an index signature. */
type QueryParams = {
  from: number;
  to: number;
  harness?: string;
  sessionId?: string;
};

export interface BucketFilter {
  /** Epoch ms; buckets whose hour overlaps `[from, to)`. */
  readonly from: number;
  readonly to: number;
  readonly harness: string | null;
  readonly sessionId: string | null;
}

export const queryBuckets = (db: Database, filter: BucketFilter): Array<UsageBucket> => {
  const where = ["u.hour >= $from", "u.hour < $to"];

  if (filter.harness !== null) where.push("u.harness = $harness");

  if (filter.sessionId !== null) where.push("m.session_id = $sessionId");

  const params: QueryParams = { from: hourOf(filter.from), to: filter.to };

  if (filter.harness !== null) params.harness = filter.harness;

  if (filter.sessionId !== null) params.sessionId = filter.sessionId;

  return db
    .query<BucketRow, [QueryParams]>(`${SELECT} WHERE ${where.join(" AND ")} ${GROUP}`)
    .all(params)
    .map(toBucket);
};

/** The buckets of the given hours (and Harness), for what one pass changed. */
export const bucketsInHours = (
  db: Database,
  harness: string,
  hours: ReadonlyArray<number>
): Array<UsageBucket> => {
  if (hours.length === 0) return [];

  return db
    .query<BucketRow, Array<string | number>>(
      `${SELECT} WHERE u.harness = ? AND u.hour IN (${hours.map(() => "?").join(", ")}) ${GROUP}`
    )
    .all(harness, ...hours)
    .map(toBucket);
};

/** A bucket that has no Usage any more (its only response was replaced under another key). */
export const zeroBucket = (key: {
  readonly hour: number;
  readonly harness: string;
  readonly model: string;
  readonly sessionId: string | null;
}): UsageBucket =>
  new UsageBucket({
    hour: new Date(key.hour).toISOString(),
    harness: key.harness,
    model: key.model,
    sessionId: key.sessionId === null ? null : SessionId.make(key.sessionId),
    tokens: new TokenCounts({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 }),
    reportedCost: null,
  });

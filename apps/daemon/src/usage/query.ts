/**
 * Hourly buckets from the index: grouped by hour, Harness, Model and Agent
 * Session, where a Harness session id Polaris drove maps to its Agent Session.
 */
import type { Database } from "bun:sqlite";
import {
  LongContextTokens,
  noTokens,
  ReportedCost,
  SessionId,
  TokenCounts,
  UsageBucket,
} from "@polaris/protocol";
import { hourOf } from "./writer.ts";

/** The long-context thresholds buckets report: Claude's 200k and OpenAI's 272k. */
export const LONG_CONTEXT_THRESHOLDS = [200_000, 272_000] as const;

const COLUMNS = {
  input: "input",
  cacheRead: "cache_read",
  cacheWrite: "cache_write",
  output: "output",
  reasoning: "reasoning",
  cacheWrite1h: "cache_write_1h",
} as const;

type Kind = keyof typeof COLUMNS;

/** Each sum a bucket needs: all its tokens, those with a reported cost, and each long-context subset. */
const SUBSETS = {
  all: "1",
  costed: "u.cost IS NOT NULL",
  long200k: `u.context > ${LONG_CONTEXT_THRESHOLDS[0]}`,
  long272k: `u.context > ${LONG_CONTEXT_THRESHOLDS[1]}`,
} as const;

type Subset = keyof typeof SUBSETS;

type BucketRow = {
  readonly hour: number;
  readonly harness: string;
  readonly model: string;
  readonly session_id: string | null;
  readonly cost: number | null;
} & { readonly [K in `${Subset}_${Kind}`]: number };

const sums = Object.entries(SUBSETS).flatMap(([subset, condition]) =>
  Object.entries(COLUMNS).map(
    ([kind, column]) =>
      `SUM(CASE WHEN ${condition} THEN u.${column} ELSE 0 END) AS ${subset}_${kind}`
  )
);

const SELECT = `
SELECT u.hour AS hour, u.harness AS harness, u.model AS model, m.session_id AS session_id,
  SUM(u.cost) AS cost, ${sums.join(",\n  ")}
FROM usage u LEFT JOIN session_map m ON m.harness = u.harness AND m.native = u.native`;

const GROUP =
  "GROUP BY u.hour, u.harness, u.model, m.session_id ORDER BY u.hour, u.harness, u.model";

const tokensOf = (row: BucketRow, subset: Subset) =>
  new TokenCounts({
    input: row[`${subset}_input`],
    cacheRead: row[`${subset}_cacheRead`],
    cacheWrite: row[`${subset}_cacheWrite`],
    output: row[`${subset}_output`],
    reasoning: row[`${subset}_reasoning`],
    cacheWrite1h: row[`${subset}_cacheWrite1h`],
  });

const longContext = (row: BucketRow): Array<LongContextTokens> =>
  (["long200k", "long272k"] as const).flatMap((subset, index) => {
    const tokens = tokensOf(row, subset);
    const above = LONG_CONTEXT_THRESHOLDS[index] ?? 0;

    return tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output === 0
      ? []
      : [new LongContextTokens({ above, tokens })];
  });

const toBucket = (row: BucketRow): UsageBucket =>
  new UsageBucket({
    hour: new Date(row.hour).toISOString(),
    harness: row.harness,
    model: row.model,
    sessionId: row.session_id === null ? null : SessionId.make(row.session_id),
    tokens: tokensOf(row, "all"),
    reportedCost:
      row.cost === null
        ? null
        : new ReportedCost({ usd: row.cost, tokens: tokensOf(row, "costed") }),
    longContext: longContext(row),
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
    tokens: noTokens,
    reportedCost: null,
    longContext: [],
  });

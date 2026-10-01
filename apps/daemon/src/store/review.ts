/**
 * The store's side of Review: Risk Summaries and Verdicts live in SQL only
 * (`risk_summaries`, `verdicts`), never in the read model, so they cost no
 * memory between Reviews. Review Checkouts are in the read model (`model.ts`).
 */
import {
  DomainEvent,
  type FindingStatus,
  RiskFinding,
  RiskSummary,
  type RiskSummaryId,
  type RiskSummaryKey,
  RiskSummaryLayers,
  RiskSummaryRef,
  Verdict,
} from "@polaris/protocol";
import { Effect, Schema } from "effect";
import type { SqlClient, SqlError } from "effect/sql";
import { storeError } from "./errors.ts";

const json = <A, I>(schema: Schema.Codec<A, I>) => {
  const codec = Schema.toCodecJson(schema);
  const encode = Schema.encodeSync(codec);
  const decode = Schema.decodeUnknownSync(codec);

  return {
    encode: (value: A): string => JSON.stringify(encode(value)),
    decode: (text: string): A => decode(JSON.parse(text)),
  };
};

export const RiskSummaryJson = json(RiskSummary);

export const VerdictJson = json(Verdict);

// ── The summary fold ────────────────────────────────────────────────────────

type SummaryChange = (summary: RiskSummary, at: string) => RiskSummary;

const patch = (summary: RiskSummary, change: Partial<typeof RiskSummary.Type>): RiskSummary =>
  new RiskSummary({
    id: summary.id,
    key: summary.key,
    workspaceId: summary.workspaceId,
    subject: summary.subject,
    checkoutId: summary.checkoutId,
    status: summary.status,
    layers: summary.layers,
    reviewer: summary.reviewer,
    cost: summary.cost,
    note: summary.note,
    findings: summary.findings,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    ...change,
  });

const patchFinding = (finding: RiskFinding, change: Partial<typeof RiskFinding.Type>) =>
  new RiskFinding({
    id: finding.id,
    identity: finding.identity,
    source: finding.source,
    ruleId: finding.ruleId,
    path: finding.path,
    lines: finding.lines,
    severity: finding.severity,
    confidence: finding.confidence,
    title: finding.title,
    reason: finding.reason,
    suggestion: finding.suggestion,
    status: finding.status,
    resolution: finding.resolution,
    ...change,
  });

const mapFinding =
  (findingId: RiskFinding["id"], f: (finding: RiskFinding) => RiskFinding): SummaryChange =>
  (summary) =>
    patch(summary, {
      findings: summary.findings.map((finding) =>
        finding.id === findingId ? f(finding) : finding
      ),
    });

/** A thumbs-down dismisses; a thumbs-up reopens. A Resolved Finding stays Resolved. */
const statusAfterVerdict = (finding: RiskFinding, thumb: Verdict["thumb"]): FindingStatus => {
  if (finding.status === "resolved") return "resolved";

  return thumb === "down" ? "dismissed" : "open";
};

const noChange: SummaryChange = (summary) => summary;

/** What a review event changes in the summary it is about (`summaryIdOf`). */
const summaryChange: (event: DomainEvent) => SummaryChange = (event) =>
  DomainEvent.matchOrElse(
    event,
    {
      RiskSummaryLayerChanged:
        ({ layer, run }): SummaryChange =>
        (summary) =>
          patch(summary, {
            layers: new RiskSummaryLayers({
              rules: layer === "rules" ? run : summary.layers.rules,
              agent: layer === "agent" ? run : summary.layers.agent,
            }),
          }),
      RiskFindingsRecorded:
        ({ findings }): SummaryChange =>
        (summary) => {
          const byId = new Map(findings.map((finding) => [finding.id, finding]));
          const kept = summary.findings.map((finding) => byId.get(finding.id) ?? finding);
          const known = new Set(summary.findings.map((finding) => finding.id));

          return patch(summary, {
            findings: [...kept, ...findings.filter((finding) => !known.has(finding.id))],
          });
        },
      RiskFindingResolved: ({ findingId, resolution }) =>
        mapFinding(findingId, (finding) =>
          patchFinding(finding, { status: "resolved", resolution })
        ),
      RiskSummaryEnded:
        ({ status, reviewer, cost, note }): SummaryChange =>
        (summary, at) =>
          patch(summary, {
            status,
            reviewer: reviewer ?? summary.reviewer,
            cost: cost ?? summary.cost,
            note: note ?? summary.note,
            endedAt: at,
          }),
      VerdictRecorded: ({ verdict }) =>
        mapFinding(verdict.findingId, (finding) =>
          patchFinding(finding, { status: statusAfterVerdict(finding, verdict.thumb) })
        ),
    },
    () => noChange
  );

/** The Risk Summary an event is about, or null for every other event. */
export const summaryIdOf = (event: DomainEvent): RiskSummaryId | null =>
  DomainEvent.matchOrElse(
    event,
    {
      RiskSummaryStarted: ({ summary }) => summary.id,
      RiskSummaryLayerChanged: ({ summaryId }) => summaryId,
      RiskFindingsRecorded: ({ summaryId }) => summaryId,
      RiskFindingResolved: ({ summaryId }) => summaryId,
      RiskSummaryEnded: ({ summaryId }) => summaryId,
      VerdictRecorded: ({ verdict }) => verdict.summaryId,
    },
    () => null
  );

/** Fold one event into a summary: pure, and the same fold the projection writes. */
export const foldRiskSummary = (
  summary: RiskSummary | null,
  event: DomainEvent,
  at: string
): RiskSummary | null => {
  if (DomainEvent.guards.RiskSummaryStarted(event)) return event.summary;

  return summary === null ? null : summaryChange(event)(summary, at);
};

// ── Projection ──────────────────────────────────────────────────────────────

type SqlWrite = Effect.Effect<unknown, SqlError.SqlError>;

const readSummaryRow = (sql: SqlClient.SqlClient, id: RiskSummaryId) =>
  sql<{ data: string }>`SELECT data FROM risk_summaries WHERE id = ${id}`.pipe(
    Effect.map((rows) => (rows[0] === undefined ? null : RiskSummaryJson.decode(rows[0].data)))
  );

const writeSummaryRow = (sql: SqlClient.SqlClient, summary: RiskSummary, sequence: number) =>
  sql`INSERT INTO risk_summaries ${sql.insert({
    id: summary.id,
    repo: summary.key.repo,
    merge_base: summary.key.mergeBase,
    head: summary.key.head,
    since: summary.key.since,
    started_sequence: sequence,
    data: RiskSummaryJson.encode(summary),
  })}
  ON CONFLICT (id) DO UPDATE SET data = excluded.data`;

/**
 * Persist what a review event changes: the summary row (read, folded,
 * written back inside the commit's transaction) and a Verdict's own row.
 */
export const projectReviewEvent = (
  sql: SqlClient.SqlClient,
  event: DomainEvent,
  sequence: number,
  at: string
): SqlWrite =>
  Effect.gen(function* () {
    const summaryId = summaryIdOf(event);

    if (summaryId === null) return;

    if (DomainEvent.guards.VerdictRecorded(event)) {
      const { verdict } = event;
      yield* sql`INSERT OR REPLACE INTO verdicts ${sql.insert({
        id: verdict.id,
        repo: verdict.repo,
        summary_id: verdict.summaryId,
        identity: verdict.finding.identity,
        recorded_sequence: sequence,
        data: VerdictJson.encode(verdict),
      })}`;
    }

    const before = DomainEvent.guards.RiskSummaryStarted(event)
      ? null
      : yield* readSummaryRow(sql, summaryId);

    const after = foldRiskSummary(before, event, at);

    if (after !== null) yield* writeSummaryRow(sql, after, sequence);
  });

// ── Reads ───────────────────────────────────────────────────────────────────

export interface VerdictQuery {
  readonly repo: string | null;
  readonly summaryId: RiskSummaryId | null;
  readonly identity: string | null;
  readonly limit: number;
}

export interface ReviewReads {
  readonly riskSummary: (ref: RiskSummaryRef) => Effect.Effect<RiskSummary | null>;
  /** A repo's summaries of one head, newest first (an incremental summary's predecessors). */
  readonly riskSummariesAt: (
    repo: string,
    head: string,
    limit: number
  ) => Effect.Effect<ReadonlyArray<RiskSummary>>;
  readonly verdicts: (query: VerdictQuery) => Effect.Effect<ReadonlyArray<Verdict>>;
}

const latestFor = (sql: SqlClient.SqlClient, key: RiskSummaryKey) =>
  sql<{ data: string }>`
    SELECT data FROM risk_summaries
    WHERE repo = ${key.repo} AND merge_base = ${key.mergeBase} AND head = ${key.head}
      AND since IS ${key.since}
    ORDER BY started_sequence DESC LIMIT 1`.pipe(
    Effect.map((rows) => (rows[0] === undefined ? null : RiskSummaryJson.decode(rows[0].data)))
  );

/** Store errors are defects here, as for the other reads a Client can't act on. */
export const reviewReads = (sql: SqlClient.SqlClient): ReviewReads => ({
  riskSummary: (ref) =>
    RiskSummaryRef.match(ref, {
      ById: ({ summaryId }) => readSummaryRow(sql, summaryId),
      ByKey: ({ key }) => latestFor(sql, key),
      LatestAt: ({ repo, head }) =>
        sql<{ data: string }>`
          SELECT data FROM risk_summaries WHERE repo = ${repo} AND head = ${head}
          ORDER BY started_sequence DESC LIMIT 1`.pipe(
          Effect.map((rows) =>
            rows[0] === undefined ? null : RiskSummaryJson.decode(rows[0].data)
          )
        ),
    }).pipe(Effect.mapError(storeError("read a Risk Summary")), Effect.orDie),
  riskSummariesAt: (repo, head, limit) =>
    sql<{ data: string }>`
      SELECT data FROM risk_summaries WHERE repo = ${repo} AND head = ${head}
      ORDER BY started_sequence DESC LIMIT ${limit}`.pipe(
      Effect.map((rows) => rows.map((row) => RiskSummaryJson.decode(row.data))),
      Effect.mapError(storeError("read Risk Summaries")),
      Effect.orDie
    ),
  verdicts: (query) =>
    sql<{ data: string }>`
      SELECT data FROM verdicts
      WHERE (${query.repo} IS NULL OR repo = ${query.repo})
        AND (${query.summaryId} IS NULL OR summary_id = ${query.summaryId})
        AND (${query.identity} IS NULL OR identity = ${query.identity})
      ORDER BY recorded_sequence DESC LIMIT ${query.limit}`.pipe(
      Effect.map((rows) => rows.map((row) => VerdictJson.decode(row.data))),
      Effect.mapError(storeError("read Verdicts")),
      Effect.orDie
    ),
});

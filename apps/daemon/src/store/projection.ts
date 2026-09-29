/**
 * The SQL side of the store: JSON codecs for what it persists, the `events`
 * row of an envelope, the projection tables an envelope changes, and loading
 * the read model back from those tables on start.
 */
import {
  AgentSession,
  ApprovalRequest,
  CommandId,
  CommandRejected,
  DomainEvent,
  EventEnvelope,
  NotFound,
  RequestId,
  Sequence,
  type SessionId,
  Turn,
  TurnItem,
  Workspace,
  Worktree,
} from "@polaris/protocol";
import { Effect, Schema } from "effect";
import type { SqlClient, SqlError } from "effect/sql";
import { ServiceError } from "../services.ts";
import {
  emptyModel,
  RECENT_TURNS,
  type ReadModel,
  type SessionRecord,
  sessionOf,
} from "./model.ts";

// ── Codecs ──────────────────────────────────────────────────────────────────

const json = <A, I>(schema: Schema.Codec<A, I>) => {
  const codec = Schema.toCodecJson(schema);
  const encode = Schema.encodeSync(codec);
  const decode = Schema.decodeUnknownSync(codec);

  return {
    encode: (value: A): string => JSON.stringify(encode(value)),
    decode: (text: string): A => decode(JSON.parse(text)),
  };
};

export const EventJson = json(DomainEvent);

export const WorkspaceJson = json(Workspace);

export const WorktreeJson = json(Worktree);

export const SessionJson = json(AgentSession);

export const TurnJson = json(Turn);

export const TurnItemJson = json(TurnItem);

export const ApprovalJson = json(ApprovalRequest);

export const RejectionJson = json(Schema.Union([CommandRejected, NotFound]));

export const storeError = (what: string) => (cause: unknown) =>
  new ServiceError({ service: "store", message: `failed to ${what}`, cause });

// ── Events ──────────────────────────────────────────────────────────────────

export interface EventRow {
  readonly sequence: number;
  readonly occurred_at: string;
  readonly command_id: string | null;
  readonly payload: string;
}

export const decodeEventRow = (row: EventRow): EventEnvelope =>
  new EventEnvelope({
    sequence: Sequence.make(row.sequence),
    occurredAt: row.occurred_at,
    commandId: row.command_id === null ? null : CommandId.make(row.command_id),
    event: EventJson.decode(row.payload),
  });

export const writeEvent = (sql: SqlClient.SqlClient, envelope: EventEnvelope) => {
  const sessionId = sessionOf(envelope.event);

  return sql`INSERT INTO events ${sql.insert({
    sequence: envelope.sequence,
    stream_kind: sessionId === null ? "host" : "session",
    session_id: sessionId,
    event_type: envelope.event._tag,
    command_id: envelope.commandId,
    occurred_at: envelope.occurredAt,
    payload: EventJson.encode(envelope.event),
  })}`;
};

// ── Projections ─────────────────────────────────────────────────────────────

type SqlWrite = Effect.Effect<unknown, SqlError.SqlError>;

/** An envelope being projected, the model after it, and the database. */
interface Projecting {
  readonly sql: SqlClient.SqlClient;
  readonly after: ReadModel;
  readonly envelope: EventEnvelope;
}

type Projection = (target: Projecting) => SqlWrite;

const upsertSession = (sql: SqlClient.SqlClient, record: SessionRecord | undefined) =>
  record === undefined
    ? Effect.void
    : sql`INSERT OR REPLACE INTO sessions ${sql.insert({
        id: record.session.id,
        workspace_id: record.session.workspaceId,
        state: record.session.state,
        title_locked: record.titleLocked ? 1 : 0,
        data: SessionJson.encode(record.session),
      })}`;

const upsertTurn = (sql: SqlClient.SqlClient, turn: Turn | undefined) =>
  turn === undefined
    ? Effect.void
    : sql`INSERT OR REPLACE INTO turns ${sql.insert({
        id: turn.id,
        session_id: turn.sessionId,
        turn_index: turn.index,
        status: turn.status,
        data: TurnJson.encode(turn),
      })}`;

/** Every session event rewrites its session's row; `also` is what else it changes. */
const sessionRow =
  (sessionId: SessionId, also?: (target: Projecting) => SqlWrite): Projection =>
  (target) => {
    const session = upsertSession(target.sql, target.after.sessions.get(sessionId));

    return also === undefined ? session : Effect.all([session, also(target)]);
  };

const setWorkspace = ({ sql }: Projecting, workspace: Workspace) =>
  sql`INSERT OR REPLACE INTO workspaces ${sql.insert({
    id: workspace.id,
    path: workspace.path,
    data: WorkspaceJson.encode(workspace),
  })}`;

const turnRow = (turn: Turn) => sessionRow(turn.sessionId, ({ sql }) => upsertTurn(sql, turn));

const withdrawnRequest = (event: {
  readonly sessionId: SessionId;
  readonly requestId: RequestId;
}) =>
  sessionRow(
    event.sessionId,
    ({ sql }) => sql`DELETE FROM pending_approvals WHERE request_id = ${event.requestId}`
  );

const projectionOf: (event: DomainEvent) => Projection = DomainEvent.match<Projection>({
  WorkspaceRegistered: (event) => (target) => setWorkspace(target, event.workspace),
  WorkspaceUpdated: (event) => (target) => setWorkspace(target, event.workspace),
  WorkspaceRemoved:
    ({ workspaceId }) =>
    ({ sql }) =>
      Effect.all([
        sql`DELETE FROM workspaces WHERE id = ${workspaceId}`,
        sql`DELETE FROM worktrees WHERE workspace_id = ${workspaceId}`,
      ]),
  WorktreeDetected:
    ({ worktree }) =>
    ({ sql }) =>
      sql`INSERT OR REPLACE INTO worktrees ${sql.insert({
        id: worktree.id,
        workspace_id: worktree.workspaceId,
        data: WorktreeJson.encode(worktree),
      })}`,
  WorktreeRemoved:
    ({ worktreeId }) =>
    ({ sql }) =>
      sql`DELETE FROM worktrees WHERE id = ${worktreeId}`,
  SessionCreated: (event) => sessionRow(event.session.id),
  SessionStateChanged: (event) => sessionRow(event.sessionId),
  SessionRenamed: (event) => sessionRow(event.sessionId),
  SessionCursorUpdated: (event) => sessionRow(event.sessionId),
  SessionPermissionModeChanged: (event) => sessionRow(event.sessionId),
  SessionModelChanged: (event) => sessionRow(event.sessionId),
  TurnStarted: ({ turn }) => turnRow(turn),
  TurnEnded: ({ turn }) => turnRow(turn),
  CheckpointRecorded: (event) =>
    sessionRow(event.sessionId, ({ sql, after }) =>
      upsertTurn(
        sql,
        after.sessions.get(event.sessionId)?.turns.find((t) => t.id === event.turnId)
      )
    ),
  TurnItemCompleted: (event) =>
    sessionRow(
      event.sessionId,
      ({ sql, envelope }) =>
        sql`INSERT INTO turn_items ${sql.insert({
          sequence: envelope.sequence,
          session_id: event.sessionId,
          turn_id: event.turnId,
          item_id: event.item.id,
          data: TurnItemJson.encode(event.item),
        })}`
    ),
  ApprovalRequested: ({ request }) =>
    sessionRow(
      request.sessionId,
      ({ sql }) =>
        sql`INSERT OR REPLACE INTO pending_approvals ${sql.insert({
          request_id: request.id,
          session_id: request.sessionId,
          data: ApprovalJson.encode(request),
        })}`
    ),
  ApprovalResolved: withdrawnRequest,
  ApprovalWithdrawn: withdrawnRequest,
});

/** Persist what `envelope` changed in the read model `after` it. */
export const writeProjection = (
  sql: SqlClient.SqlClient,
  after: ReadModel,
  envelope: EventEnvelope
): SqlWrite => projectionOf(envelope.event)({ sql, after, envelope });

// ── Loading ─────────────────────────────────────────────────────────────────

const byId = <A extends { readonly id: K }, K>(items: ReadonlyArray<A>) =>
  new Map(items.map((item) => [item.id, item]));

export const loadModel = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const [max] = yield* sql<{
      sequence: number | null;
    }>`SELECT MAX(sequence) AS sequence FROM events`;

    const workspaces = yield* sql<{ data: string }>`SELECT data FROM workspaces`;
    const worktrees = yield* sql<{ data: string }>`SELECT data FROM worktrees`;

    const sessions = yield* sql<{ data: string; title_locked: number }>`
      SELECT data, title_locked FROM sessions`;

    // Only the most recent Turns of each session stay in memory (see RECENT_TURNS).
    const turns = yield* sql<{ data: string }>`
      SELECT data FROM (
        SELECT data, session_id, turn_index,
          ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY turn_index DESC) AS recency
        FROM turns
      ) WHERE recency <= ${RECENT_TURNS}
      ORDER BY session_id, turn_index`;

    const pending = yield* sql<{ data: string }>`SELECT data FROM pending_approvals`;

    const turnsBySession = new Map<string, Array<Turn>>();

    for (const row of turns) {
      const turn = TurnJson.decode(row.data);
      const list = turnsBySession.get(turn.sessionId) ?? [];
      list.push(turn);
      turnsBySession.set(turn.sessionId, list);
    }

    const pendingBySession = new Map<string, Map<RequestId, ApprovalRequest>>();

    for (const row of pending) {
      const request = ApprovalJson.decode(row.data);
      const map = pendingBySession.get(request.sessionId) ?? new Map<RequestId, ApprovalRequest>();
      map.set(request.id, request);
      pendingBySession.set(request.sessionId, map);
    }

    const records = sessions.map((row): SessionRecord => {
      const session = SessionJson.decode(row.data);

      return {
        session,
        titleLocked: row.title_locked === 1,
        turns: turnsBySession.get(session.id) ?? [],
        pending: pendingBySession.get(session.id) ?? new Map(),
      };
    });

    const model: ReadModel = {
      ...emptyModel,
      sequence: max?.sequence ?? 0,
      workspaces: byId(workspaces.map((row) => WorkspaceJson.decode(row.data))),
      worktrees: byId(worktrees.map((row) => WorktreeJson.decode(row.data))),
      sessions: new Map(records.map((record) => [record.session.id, record])),
    };

    return model;
  });

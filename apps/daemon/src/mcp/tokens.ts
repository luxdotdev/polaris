import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { type AttemptId, type ConstellationId, type SessionId } from "@polaris/protocol";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { McpBinding } from "./binding.ts";

export class McpTokenError extends Schema.TaggedError<McpTokenError>()("McpTokenError", {
  message: Schema.String,
}) {}

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

const Row = Schema.Struct({ binding: Schema.String });

const decodeRow = Schema.decodeUnknownOption(Row);

const decodeBinding = Schema.decodeUnknownOption(Schema.fromJsonString(McpBinding));

export class McpTokens extends Context.Service<
  McpTokens,
  {
    readonly issue: (binding: McpBinding) => Effect.Effect<string, McpTokenError>;
    readonly authenticate: (token: string) => Effect.Effect<McpBinding | null, McpTokenError>;
    readonly revokeConstellation: (id: ConstellationId) => Effect.Effect<void, McpTokenError>;
    readonly revokeSession: (sessionId: SessionId) => Effect.Effect<void, McpTokenError>;
    readonly revokeAttempt: (attemptId: AttemptId) => Effect.Effect<void, McpTokenError>;
  }
>()("polaris/mcp/Tokens") {
  static layer(path: string) {
    return Layer.effect(
      McpTokens,
      Effect.gen(function* () {
        const db = yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              const database = new Database(path, { create: true });
              chmodSync(path, 0o600);

              return database;
            },
            catch: () => new McpTokenError({ message: "Could not open MCP bindings" }),
          }),
          (database) => Effect.sync(() => database.close())
        );

        db.exec(`CREATE TABLE IF NOT EXISTS mcp_bindings (
        hash TEXT PRIMARY KEY, session_id TEXT NOT NULL, constellation_id TEXT NOT NULL, attempt_id TEXT,
        binding TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
      )`);

        const run = <A>(body: () => A) =>
          Effect.try({
            try: body,
            catch: () => new McpTokenError({ message: "Could not access MCP bindings" }),
          });

        return McpTokens.of({
          issue: (binding) =>
            run(() => {
              const token = randomBytes(32).toString("hex");
              const attemptId = McpBinding.isAnyOf(["Worker"])(binding) ? binding.attemptId : null;
              db.query(
                "INSERT INTO mcp_bindings (hash, session_id, constellation_id, attempt_id, binding) VALUES (?, ?, ?, ?, ?)"
              ).run(
                digest(token),
                binding.sessionId,
                binding.constellationId,
                attemptId,
                JSON.stringify(binding)
              );

              return token;
            }),
          authenticate: (token) =>
            run(() => {
              if (!/^[a-f0-9]{64}$/.test(token)) return null;

              const row = decodeRow(
                db
                  .query("SELECT binding FROM mcp_bindings WHERE hash = ? AND revoked = 0")
                  .get(digest(token))
              );

              return Option.isSome(row) ? Option.getOrNull(decodeBinding(row.value.binding)) : null;
            }),
          revokeConstellation: (id) =>
            run(() => {
              db.query("UPDATE mcp_bindings SET revoked = 1 WHERE constellation_id = ?").run(id);
            }),
          revokeSession: (id) =>
            run(() => {
              db.query("UPDATE mcp_bindings SET revoked = 1 WHERE session_id = ?").run(id);
            }),
          revokeAttempt: (id) =>
            run(() => {
              db.query("UPDATE mcp_bindings SET revoked = 1 WHERE attempt_id = ?").run(id);
            }),
        });
      })
    );
  }
}

/**
 * The Pairing store (CONTEXT.md: Pairing, Grant): one SQLite file beside the
 * event store, holding each Pairing and the SHA-256 of its token, never the
 * token. Modelled on `mcp/tokens.ts`.
 */
import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { EXTENSION_TOKEN_PREFIX, Grant, GRANT_KINDS, Pairing, PairingId } from "@polaris/protocol";
import { Context, Effect, Layer, Option, Schema } from "effect";

export class PairingStoreError extends Schema.TaggedError<PairingStoreError>()(
  "PairingStoreError",
  { message: Schema.String }
) {}

/** What a presented token proves. */
export const TokenCheck = Schema.TaggedUnion({
  Valid: { pairing: Pairing },
  Malformed: {},
  Unknown: {},
  Revoked: { pairing: Pairing },
});

export type TokenCheck = typeof TokenCheck.Type;

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** `pol_ext_` and base64url of 32 bytes (43 characters, no padding). */
const TOKEN = new RegExp(`^${EXTENSION_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`);

const Row = Schema.Struct({
  id: PairingId,
  name: Schema.String,
  grant: Schema.fromJsonString(Grant),
  created_at: Schema.String,
  last_used_at: Schema.NullOr(Schema.String),
  revoked_at: Schema.NullOr(Schema.String),
});

const decodeRow = Schema.decodeUnknownOption(Row);

const decodeRows = Schema.decodeUnknownOption(Schema.Array(Row));

const toPairing = (row: typeof Row.Type) =>
  new Pairing({
    id: row.id,
    name: row.name,
    grant: row.grant,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  });

/** A Grant as stored: each kind at most once, in the catalogue's order. */
export const normalizeGrant = (grant: Grant): Grant =>
  GRANT_KINDS.filter((kind) => grant.includes(kind));

const COLUMNS = "id, name, grant, created_at, last_used_at, revoked_at";

export class Pairings extends Context.Service<
  Pairings,
  {
    /** Makes a Pairing; the token is returned once and only its hash is kept. */
    readonly pair: (
      name: string,
      grant: Grant
    ) => Effect.Effect<{ readonly pairing: Pairing; readonly token: string }, PairingStoreError>;
    readonly list: Effect.Effect<ReadonlyArray<Pairing>, PairingStoreError>;
    /** The Pairing after revoking it, or null when no Pairing has that id. */
    readonly revoke: (id: PairingId) => Effect.Effect<Pairing | null, PairingStoreError>;
    readonly authenticate: (token: string) => Effect.Effect<TokenCheck, PairingStoreError>;
    /** Records that the Pairing's token opened a connection now. */
    readonly touch: (id: PairingId) => Effect.Effect<void, PairingStoreError>;
  }
>()("polaris/daemon/extensions/Pairings") {
  static layer(path: string) {
    return Layer.effect(
      Pairings,
      Effect.gen(function* () {
        const db = yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              const database = new Database(path, { create: true });
              chmodSync(path, 0o600);

              return database;
            },
            catch: () => new PairingStoreError({ message: "Could not open the Pairing store" }),
          }),
          (database) => Effect.sync(() => database.close())
        );

        db.exec(`CREATE TABLE IF NOT EXISTS pairings (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, grant TEXT NOT NULL, created_at TEXT NOT NULL,
          last_used_at TEXT, revoked_at TEXT, hash TEXT NOT NULL UNIQUE
        )`);

        const run = <A>(body: () => A) =>
          Effect.try({
            try: body,
            catch: () => new PairingStoreError({ message: "Could not access the Pairing store" }),
          });

        const byId = (id: PairingId) =>
          Option.map(
            decodeRow(db.query(`SELECT ${COLUMNS} FROM pairings WHERE id = ?`).get(id)),
            toPairing
          );

        return Pairings.of({
          pair: (name, grant) =>
            run(() => {
              const token = `${EXTENSION_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;

              const pairing = new Pairing({
                id: PairingId.make(`pair_${crypto.randomUUID()}`),
                name,
                grant: normalizeGrant(grant),
                createdAt: new Date().toISOString(),
                lastUsedAt: null,
                revokedAt: null,
              });

              db.query(
                `INSERT INTO pairings (${COLUMNS}, hash) VALUES (?, ?, ?, ?, NULL, NULL, ?)`
              ).run(
                pairing.id,
                pairing.name,
                JSON.stringify(pairing.grant),
                pairing.createdAt,
                digest(token)
              );

              return { pairing, token };
            }),
          list: run(() =>
            Option.getOrElse(
              decodeRows(db.query(`SELECT ${COLUMNS} FROM pairings ORDER BY rowid`).all()),
              () => []
            ).map(toPairing)
          ),
          revoke: (id) =>
            run(() => {
              db.query(
                "UPDATE pairings SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL"
              ).run(new Date().toISOString(), id);

              return Option.getOrNull(byId(id));
            }),
          authenticate: (token) =>
            run(() => {
              if (!TOKEN.test(token)) return TokenCheck.cases.Malformed.make({});

              const row = decodeRow(
                db.query(`SELECT ${COLUMNS} FROM pairings WHERE hash = ?`).get(digest(token))
              );

              if (Option.isNone(row)) return TokenCheck.cases.Unknown.make({});
              const pairing = toPairing(row.value);

              return pairing.revokedAt === null
                ? TokenCheck.cases.Valid.make({ pairing })
                : TokenCheck.cases.Revoked.make({ pairing });
            }),
          touch: (id) =>
            run(() => {
              db.query("UPDATE pairings SET last_used_at = ? WHERE id = ?").run(
                new Date().toISOString(),
                id
              );
            }),
        });
      })
    );
  }
}

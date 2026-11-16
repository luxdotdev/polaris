/**
 * The Share store (CONTEXT.md: Share; ADR 0112): one SQLite file beside the event store with
 * each Share, the Invite it waits on, its log and the devices it has admitted. The host
 * capability is not here: it lives in HostSecrets.
 */
import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { InviteId, Share, ShareId, ShareLogEntry } from "@polaris/protocol";
import { Context, Effect, Layer, Option, Schema } from "effect";

export class ShareStoreError extends Schema.TaggedError<ShareStoreError>()("ShareStoreError", {
  message: Schema.String,
}) {}

/** A Share as the Host keeps it: with its Invite and what the log already says of it. */
export interface StoredShare {
  readonly share: Share;
  readonly inviteId: InviteId;
  /** The person is pinned: the issuer named who accepted the Invite. */
  readonly accepted: boolean;
  /** Its expiry is in the log; cleared when it is renewed. */
  readonly expiredLogged: boolean;
}

const Row = Schema.Struct({
  share: Schema.fromJsonString(Share),
  invite_id: InviteId,
  accepted: Schema.Int,
  expired_logged: Schema.Int,
});

const decodeRows = Schema.decodeUnknownOption(Schema.Array(Row));

const encodeShare = Schema.encodeSync(Schema.fromJsonString(Share));

const LogRow = Schema.Struct({ entry: Schema.fromJsonString(ShareLogEntry) });

const decodeLog = Schema.decodeUnknownOption(Schema.Array(LogRow));

const encodeEntry = Schema.encodeSync(Schema.fromJsonString(ShareLogEntry));

const toStored = (row: typeof Row.Type): StoredShare => ({
  share: row.share,
  inviteId: row.invite_id,
  accepted: row.accepted === 1,
  expiredLogged: row.expired_logged === 1,
});

export class ShareStore extends Context.Service<
  ShareStore,
  {
    /** Every Share, ended ones included, oldest first. */
    readonly all: Effect.Effect<ReadonlyArray<StoredShare>, ShareStoreError>;
    /** Stores a new Share with the first entry of its log. */
    readonly create: (
      stored: StoredShare,
      entry: ShareLogEntry
    ) => Effect.Effect<void, ShareStoreError>;
    /** Replaces a Share and appends `entry` to its log, as one write. */
    readonly update: (
      stored: StoredShare,
      entry: ShareLogEntry | null
    ) => Effect.Effect<void, ShareStoreError>;
    readonly log: (id: ShareId) => Effect.Effect<ReadonlyArray<ShareLogEntry>, ShareStoreError>;
    /** Records a device of the Share; false when it was admitted before. */
    readonly addDevice: (
      id: ShareId,
      deviceKey: string,
      entry: ShareLogEntry
    ) => Effect.Effect<boolean, ShareStoreError>;
  }
>()("polaris/daemon/shares/ShareStore") {
  static layer(path: string) {
    return Layer.effect(
      ShareStore,
      Effect.gen(function* () {
        const db = yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              const database = new Database(path, { create: true });
              chmodSync(path, 0o600);

              return database;
            },
            catch: () => new ShareStoreError({ message: "Could not open the Share store" }),
          }),
          (database) => Effect.sync(() => database.close())
        );

        db.exec(`CREATE TABLE IF NOT EXISTS shares (
          id TEXT PRIMARY KEY, share TEXT NOT NULL, invite_id TEXT NOT NULL,
          accepted INTEGER NOT NULL DEFAULT 0, expired_logged INTEGER NOT NULL DEFAULT 0
        )`);
        db.exec(`CREATE TABLE IF NOT EXISTS share_log (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, share_id TEXT NOT NULL, entry TEXT NOT NULL
        )`);
        db.exec(`CREATE TABLE IF NOT EXISTS share_devices (
          share_id TEXT NOT NULL, device_key TEXT NOT NULL, PRIMARY KEY (share_id, device_key)
        )`);

        const run = <A>(body: () => A) =>
          Effect.try({
            try: body,
            catch: () => new ShareStoreError({ message: "Could not access the Share store" }),
          });

        const append = (entry: ShareLogEntry) =>
          db
            .query("INSERT INTO share_log (share_id, entry) VALUES (?, ?)")
            .run(entry.shareId, encodeEntry(entry));

        const put = ({ share, inviteId, accepted, expiredLogged }: StoredShare) =>
          db
            .query(
              `INSERT INTO shares (id, share, invite_id, accepted, expired_logged)
               VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET share = excluded.share,
               accepted = excluded.accepted, expired_logged = excluded.expired_logged`
            )
            .run(share.id, encodeShare(share), inviteId, accepted ? 1 : 0, expiredLogged ? 1 : 0);

        return ShareStore.of({
          all: run(() =>
            Option.getOrElse(
              decodeRows(
                db
                  .query(
                    "SELECT share, invite_id, accepted, expired_logged FROM shares ORDER BY rowid"
                  )
                  .all()
              ),
              () => []
            ).map(toStored)
          ),
          create: (stored, entry) =>
            run(() =>
              db.transaction(() => {
                put(stored);
                append(entry);
              })()
            ),
          update: (stored, entry) =>
            run(() =>
              db.transaction(() => {
                put(stored);

                if (entry !== null) append(entry);
              })()
            ),
          log: (id) =>
            run(() =>
              Option.getOrElse(
                decodeLog(
                  db.query("SELECT entry FROM share_log WHERE share_id = ? ORDER BY seq").all(id)
                ),
                () => []
              ).map((row) => row.entry)
            ),
          addDevice: (id, deviceKey, entry) =>
            run(() =>
              db.transaction(() => {
                const added =
                  db
                    .query(
                      "INSERT OR IGNORE INTO share_devices (share_id, device_key) VALUES (?, ?)"
                    )
                    .run(id, deviceKey).changes > 0;

                if (added) append(entry);

                return added;
              })()
            ),
        });
      })
    );
  }
}

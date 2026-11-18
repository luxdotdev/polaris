/**
 * The Share store (CONTEXT.md: Share; ADR 0112): one SQLite file beside the event store with
 * each Share, the Invite it waits on, its log and the devices it has admitted, Teammates' push
 * registrations and who muted which target. The host capability is not here: it lives in HostSecrets.
 */
import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { InviteId, PersonId, Share, ShareId, ShareLogEntry, ShareTarget } from "@polaris/protocol";
import { PushRegistration, RelayAddress } from "@polaris/protocol/relay";
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

/** A Teammate's device registered for push over its own connection. */
export interface StoredPush {
  readonly issuer: string;
  readonly personId: PersonId;
  readonly noiseKey: string;
  readonly relayAddress: RelayAddress;
  readonly registration: PushRegistration;
}

const PushRow = Schema.Struct({
  issuer: Schema.String,
  person_id: PersonId,
  noise_key: Schema.String,
  relay_address: RelayAddress,
  registration: Schema.fromJsonString(PushRegistration),
});

const decodePushRows = Schema.decodeUnknownOption(Schema.Array(PushRow));

const encodeRegistration = Schema.encodeSync(Schema.fromJsonString(PushRegistration));

/** A person who muted a target: `owner`, or a Teammate's `issuer personId`. */
export interface StoredMute {
  readonly person: string;
  readonly target: ShareTarget;
}

const MuteRow = Schema.Struct({
  person: Schema.String,
  target: Schema.fromJsonString(ShareTarget),
});

const decodeMuteRows = Schema.decodeUnknownOption(Schema.Array(MuteRow));

const encodeTarget = Schema.encodeSync(Schema.fromJsonString(ShareTarget));

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
    readonly pushes: Effect.Effect<ReadonlyArray<StoredPush>, ShareStoreError>;
    /** Replaces the device's registration (one per Noise key). */
    readonly setPush: (push: StoredPush) => Effect.Effect<void, ShareStoreError>;
    /** Forgets it; with `token`, only while that is still the device's token. */
    readonly clearPush: (
      noiseKey: string,
      token: string | null
    ) => Effect.Effect<void, ShareStoreError>;
    readonly mutes: Effect.Effect<ReadonlyArray<StoredMute>, ShareStoreError>;
    readonly setMuted: (mute: StoredMute, muted: boolean) => Effect.Effect<void, ShareStoreError>;
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

        db.exec(`CREATE TABLE IF NOT EXISTS teammate_push (
          noise_key TEXT PRIMARY KEY, issuer TEXT NOT NULL, person_id TEXT NOT NULL,
          relay_address TEXT NOT NULL, registration TEXT NOT NULL
        )`);
        db.exec(`CREATE TABLE IF NOT EXISTS share_mutes (
          person TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY (person, target)
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
          pushes: run(() =>
            Option.getOrElse(
              decodePushRows(
                db
                  .query(
                    `SELECT issuer, person_id, noise_key, relay_address, registration
                     FROM teammate_push ORDER BY rowid`
                  )
                  .all()
              ),
              () => []
            ).map((row) => ({
              issuer: row.issuer,
              personId: row.person_id,
              noiseKey: row.noise_key,
              relayAddress: row.relay_address,
              registration: row.registration,
            }))
          ),
          setPush: (push) =>
            run(() =>
              db
                .query(
                  `INSERT OR REPLACE INTO teammate_push
                   (noise_key, issuer, person_id, relay_address, registration) VALUES (?, ?, ?, ?, ?)`
                )
                .run(
                  push.noiseKey,
                  push.issuer,
                  push.personId,
                  push.relayAddress,
                  encodeRegistration(push.registration)
                )
            ),
          clearPush: (noiseKey, token) =>
            run(() => {
              const rows = Option.getOrElse(
                decodePushRows(
                  db
                    .query(
                      `SELECT issuer, person_id, noise_key, relay_address, registration
                       FROM teammate_push WHERE noise_key = ?`
                    )
                    .all(noiseKey)
                ),
                () => []
              );

              if (token !== null && rows.every((row) => row.registration.token !== token)) return;
              db.query("DELETE FROM teammate_push WHERE noise_key = ?").run(noiseKey);
            }),
          mutes: run(() =>
            Option.getOrElse(
              decodeMuteRows(
                db.query("SELECT person, target FROM share_mutes ORDER BY rowid").all()
              ),
              () => []
            )
          ),
          setMuted: ({ person, target }, muted) =>
            run(() =>
              db
                .query(
                  muted
                    ? "INSERT OR IGNORE INTO share_mutes (person, target) VALUES (?, ?)"
                    : "DELETE FROM share_mutes WHERE person = ? AND target = ?"
                )
                .run(person, encodeTarget(target))
            ),
        });
      })
    );
  }
}

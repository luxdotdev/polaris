/**
 * The Linked Device store (CONTEXT.md: Linked Device): one SQLite file beside the
 * event store with each device's relay address and Noise static public key. Keys
 * are public halves only; unlinking keeps the row, so history still names it.
 */
import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { LinkedDevice, LinkedDeviceId } from "@polaris/protocol";
import { RelayAddress } from "@polaris/protocol/relay";
import { Context, Effect, Layer, Option, Schema } from "effect";

export class LinkedDeviceStoreError extends Schema.TaggedError<LinkedDeviceStoreError>()(
  "LinkedDeviceStoreError",
  { message: Schema.String }
) {}

const Row = Schema.Struct({
  id: LinkedDeviceId,
  name: Schema.String,
  relay_address: RelayAddress,
  noise_key: Schema.String,
  created_at: Schema.String,
  last_used_at: Schema.NullOr(Schema.String),
  unlinked_at: Schema.NullOr(Schema.String),
});

const decodeRow = Schema.decodeUnknownOption(Row);

const decodeRows = Schema.decodeUnknownOption(Schema.Array(Row));

const toDevice = (row: typeof Row.Type) =>
  new LinkedDevice({
    id: row.id,
    name: row.name,
    relayAddress: row.relay_address,
    noiseKey: row.noise_key,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    unlinkedAt: row.unlinked_at,
  });

const COLUMNS = "id, name, relay_address, noise_key, created_at, last_used_at, unlinked_at";

export interface NewDevice {
  readonly name: string;
  readonly relayAddress: RelayAddress;
  /** base64url of the X25519 public key. */
  readonly noiseKey: string;
}

export class LinkedDevices extends Context.Service<
  LinkedDevices,
  {
    /** Links a device; the same key and address linked again returns the device as it is. */
    readonly add: (device: NewDevice) => Effect.Effect<LinkedDevice, LinkedDeviceStoreError>;
    readonly list: Effect.Effect<ReadonlyArray<LinkedDevice>, LinkedDeviceStoreError>;
    /** Every device still linked, read synchronously on the relay's hot path. */
    readonly linked: () => ReadonlyArray<LinkedDevice>;
    /** The device after unlinking it, or null when no device has that id. */
    readonly unlink: (
      id: LinkedDeviceId
    ) => Effect.Effect<LinkedDevice | null, LinkedDeviceStoreError>;
    /** Records that the device opened a session now. */
    readonly touch: (id: LinkedDeviceId) => Effect.Effect<void, LinkedDeviceStoreError>;
  }
>()("polaris/daemon/linkedDevices/LinkedDevices") {
  static layer(path: string) {
    return Layer.effect(
      LinkedDevices,
      Effect.gen(function* () {
        const db = yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              const database = new Database(path, { create: true });
              chmodSync(path, 0o600);

              return database;
            },
            catch: () =>
              new LinkedDeviceStoreError({ message: "Could not open the Linked Device store" }),
          }),
          (database) => Effect.sync(() => database.close())
        );

        db.exec(`CREATE TABLE IF NOT EXISTS linked_devices (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, relay_address TEXT NOT NULL,
          noise_key TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT, unlinked_at TEXT
        )`);

        const run = <A>(body: () => A) =>
          Effect.try({
            try: body,
            catch: () =>
              new LinkedDeviceStoreError({ message: "Could not access the Linked Device store" }),
          });

        const byId = (id: LinkedDeviceId) =>
          Option.map(
            decodeRow(db.query(`SELECT ${COLUMNS} FROM linked_devices WHERE id = ?`).get(id)),
            toDevice
          );

        const linked = () =>
          Option.getOrElse(
            decodeRows(
              db
                .query(
                  `SELECT ${COLUMNS} FROM linked_devices WHERE unlinked_at IS NULL ORDER BY rowid`
                )
                .all()
            ),
            () => []
          ).map(toDevice);

        return LinkedDevices.of({
          add: ({ name, relayAddress, noiseKey }) =>
            run(() => {
              const existing = linked().find(
                (d) => d.noiseKey === noiseKey && d.relayAddress === relayAddress
              );

              if (existing !== undefined) return existing;

              const device = new LinkedDevice({
                id: LinkedDeviceId.make(`dev_${crypto.randomUUID()}`),
                name,
                relayAddress,
                noiseKey,
                createdAt: new Date().toISOString(),
                lastUsedAt: null,
                unlinkedAt: null,
              });

              db.query(
                `INSERT INTO linked_devices (${COLUMNS}) VALUES (?, ?, ?, ?, ?, NULL, NULL)`
              ).run(device.id, device.name, device.relayAddress, device.noiseKey, device.createdAt);

              return device;
            }),
          list: run(() =>
            Option.getOrElse(
              decodeRows(db.query(`SELECT ${COLUMNS} FROM linked_devices ORDER BY rowid`).all()),
              () => []
            ).map(toDevice)
          ),
          linked,
          unlink: (id) =>
            run(() => {
              db.query(
                "UPDATE linked_devices SET unlinked_at = ? WHERE id = ? AND unlinked_at IS NULL"
              ).run(new Date().toISOString(), id);

              return Option.getOrNull(byId(id));
            }),
          touch: (id) =>
            run(() => {
              db.query("UPDATE linked_devices SET last_used_at = ? WHERE id = ?").run(
                new Date().toISOString(),
                id
              );
            }),
        });
      })
    );
  }
}

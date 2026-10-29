/**
 * The Linked Device store (CONTEXT.md: Linked Device): one SQLite file beside the
 * event store with each device's relay address and Noise static public key. Keys
 * are public halves only; unlinking keeps the row, so history still names it.
 */
import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { LinkedDevice, LinkedDeviceId } from "@polaris/protocol";
import { LiveActivityRegistration, PushRegistration, RelayAddress } from "@polaris/protocol/relay";
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

const PushRow = Schema.Struct({ device_id: LinkedDeviceId, registration: Schema.String });

const decodePushRows = Schema.decodeUnknownOption(Schema.Array(PushRow));

const decodeRegistration = Schema.decodeUnknownOption(Schema.fromJsonString(PushRegistration));

const encodeRegistration = Schema.encodeSync(Schema.fromJsonString(PushRegistration));

const decodeLive = Schema.decodeUnknownOption(Schema.fromJsonString(LiveActivityRegistration));

const encodeLive = Schema.encodeSync(Schema.fromJsonString(LiveActivityRegistration));

/** A linked device's Live Activity: its update token and the key its slices are sealed to. */
export interface LiveTarget {
  readonly device: LinkedDevice;
  readonly registration: LiveActivityRegistration;
}

/** A linked device's push registration: where APNs reaches it and the key its pushes are sealed to. */
export interface PushTarget {
  readonly device: LinkedDevice;
  readonly registration: PushRegistration;
}

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
    /** Replaces the device's push registration. */
    readonly setPush: (
      id: LinkedDeviceId,
      registration: PushRegistration
    ) => Effect.Effect<void, LinkedDeviceStoreError>;
    /** Removes the device's registration; with `only`, just when it is still that one. */
    readonly clearPush: (
      id: LinkedDeviceId,
      only?: PushRegistration
    ) => Effect.Effect<void, LinkedDeviceStoreError>;
    /** Every linked device with a push registration, read synchronously. */
    readonly pushTargets: () => ReadonlyArray<PushTarget>;
    /** Replaces the device's Live Activity registration. */
    readonly setLive: (
      id: LinkedDeviceId,
      registration: LiveActivityRegistration
    ) => Effect.Effect<void, LinkedDeviceStoreError>;
    /** Removes it; with `token`, just when it is still that activity's. */
    readonly clearLive: (
      id: LinkedDeviceId,
      token?: string
    ) => Effect.Effect<void, LinkedDeviceStoreError>;
    /** Every linked device with a Live Activity registered, read synchronously. */
    readonly liveTargets: () => ReadonlyArray<LiveTarget>;
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
        db.exec(`CREATE TABLE IF NOT EXISTS push_registrations (
          device_id TEXT PRIMARY KEY, registration TEXT NOT NULL, updated_at TEXT NOT NULL
        )`);

        db.exec(`CREATE TABLE IF NOT EXISTS live_activities (
          device_id TEXT PRIMARY KEY, registration TEXT NOT NULL, updated_at TEXT NOT NULL
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

        const targets = <R>(
          table: "push_registrations" | "live_activities",
          decode: (text: string) => Option.Option<R>
        ) => {
          const devices = new Map(linked().map((device) => [device.id, device]));

          const rows = Option.getOrElse(
            decodePushRows(db.query(`SELECT device_id, registration FROM ${table}`).all()),
            () => []
          );

          return rows.flatMap((row) => {
            const device = devices.get(row.device_id);
            const registration = Option.getOrNull(decode(row.registration));

            return device === undefined || registration === null ? [] : [{ device, registration }];
          });
        };

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
              // An unlinked device is never woken again; a new link registers afresh.
              db.query("DELETE FROM push_registrations WHERE device_id = ?").run(id);
              db.query("DELETE FROM live_activities WHERE device_id = ?").run(id);

              return Option.getOrNull(byId(id));
            }),
          setPush: (id, registration) =>
            run(() => {
              db.query(
                `INSERT INTO push_registrations (device_id, registration, updated_at) VALUES (?, ?, ?)
                 ON CONFLICT(device_id) DO UPDATE SET registration = excluded.registration,
                 updated_at = excluded.updated_at`
              ).run(id, encodeRegistration(registration), new Date().toISOString());
            }),
          clearPush: (id, only) =>
            run(() => {
              if (only === undefined)
                db.query("DELETE FROM push_registrations WHERE device_id = ?").run(id);
              else
                db.query(
                  "DELETE FROM push_registrations WHERE device_id = ? AND registration = ?"
                ).run(id, encodeRegistration(only));
            }),
          pushTargets: () => targets("push_registrations", decodeRegistration),
          setLive: (id, registration) =>
            run(() => {
              db.query(
                `INSERT INTO live_activities (device_id, registration, updated_at) VALUES (?, ?, ?)
                 ON CONFLICT(device_id) DO UPDATE SET registration = excluded.registration,
                 updated_at = excluded.updated_at`
              ).run(id, encodeLive(registration), new Date().toISOString());
            }),
          clearLive: (id, token) =>
            run(() => {
              const current = targets("live_activities", decodeLive).find(
                (target) => target.device.id === id
              );

              if (token === undefined || current?.registration.token === token)
                db.query("DELETE FROM live_activities WHERE device_id = ?").run(id);
            }),
          liveTargets: () => targets("live_activities", decodeLive),
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

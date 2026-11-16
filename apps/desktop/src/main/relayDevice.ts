/**
 * This Desktop App as a relay device (ENG-943, ADR 0080): its Ed25519 relay identity and X25519
 * Noise static key, kept in `SecureStorage` as `relay-device/secrets`, and the sessions it opens
 * to Hosts reached through a relay. libsodium loads on first use, never at startup.
 */
import { type Connector, ConnectFailure, relayConnector, type RelayTarget } from "@polaris/client";
import type { DevicePublicKeys, DeviceSecrets, RelayDevice } from "@polaris/client/relay";
import { fromBase64Url, toBase64Url } from "@polaris/protocol/relay";
import { Effect, Option, Schema } from "effect";
import { SecureStorage } from "./secure/index.ts";

export const RELAY_DEVICE_KEY = "relay-device/secrets";

const Stored = Schema.fromJsonString(
  Schema.Struct({ v: Schema.Literal(1), identitySeed: Schema.String, noiseSecret: Schema.String })
);

/** No relay identity could be loaded or made; Hosts through a relay can't be reached. */
export class RelayDeviceUnavailable extends Schema.TaggedError<RelayDeviceUnavailable>()(
  "RelayDeviceUnavailable",
  { message: Schema.String }
) {}

const refuse = (message: string) => () => new RelayDeviceUnavailable({ message });

const secret = (text: string) =>
  Option.filter(fromBase64Url(text), (bytes) => bytes.byteLength === 32);

const decode = (text: string) =>
  Effect.flatMap(
    Schema.decodeUnknownEffect(Stored)(text).pipe(
      Effect.mapError(refuse("the stored relay identity is corrupt"))
    ),
    (stored) =>
      Option.match(Option.all([secret(stored.identitySeed), secret(stored.noiseSecret)]), {
        onNone: () => Effect.fail(new RelayDeviceUnavailable({ message: "corrupt relay keys" })),
        onSome: ([identitySeed, noiseSecret]): Effect.Effect<DeviceSecrets> =>
          Effect.succeed({ identitySeed, noiseSecret }),
      })
  );

const encode = (secrets: DeviceSecrets) =>
  Schema.encodeSync(Stored)({
    v: 1,
    identitySeed: toBase64Url(secrets.identitySeed),
    noiseSecret: toBase64Url(secrets.noiseSecret),
  });

/** Loads the secrets, or makes and stores them; a stored pair that won't open is never replaced. */
export const loadRelayDeviceSecrets = Effect.fn("loadRelayDeviceSecrets")(function* (
  generate: () => DeviceSecrets
) {
  const storage = yield* SecureStorage;

  if (!(yield* storage.available))
    return yield* new RelayDeviceUnavailable({ message: "no secret store on this machine" });

  const stored = yield* storage
    .get(RELAY_DEVICE_KEY)
    .pipe(Effect.mapError(refuse("the stored relay identity can't be opened")));

  if (Option.isSome(stored)) return yield* decode(stored.value);

  const secrets = generate();

  yield* storage
    .set(RELAY_DEVICE_KEY, encode(secrets))
    .pipe(Effect.mapError(refuse("the relay identity can't be stored")));

  return secrets;
});

export interface DesktopRelayDevice {
  /** The relay address and Noise key a Host is told when this app joins it (an Invite). */
  readonly publicKeys: Effect.Effect<DevicePublicKeys, RelayDeviceUnavailable>;
  /** A Relay target's Connector, for `HostConnectionOptions.relay`. */
  readonly connector: (target: RelayTarget) => Connector;
  /** Ends every relay socket. */
  readonly close: () => void;
}

/** The device behind `storage`, made on first use and kept; a failure is tried again next time. */
export const desktopRelayDevice = (
  storage: SecureStorage["Service"],
  options: { readonly backoff?: (attempt: number) => number } = {}
): DesktopRelayDevice => {
  let device: Promise<RelayDevice> | null = null;

  const open = (): Promise<RelayDevice> => {
    device ??= (async () => {
      const relay = await import("@polaris/client/relay");

      const secrets = await Effect.runPromise(
        Effect.provideService(
          loadRelayDeviceSecrets(relay.generateDeviceSecrets),
          SecureStorage,
          storage
        )
      );

      return relay.makeRelayDevice(await relay.deviceKeys(secrets), options);
    })();
    // A failed open is forgotten, so the next use tries again.
    device.catch(() => {
      device = null;
    });

    return device;
  };

  const opened = Effect.tryPromise({
    try: open,
    catch: (error) =>
      error instanceof RelayDeviceUnavailable
        ? error
        : new RelayDeviceUnavailable({ message: String(error) }),
  });

  return {
    publicKeys: Effect.promise(() => import("@polaris/client/relay")).pipe(
      Effect.flatMap((relay) => Effect.map(opened, (d) => relay.devicePublicKeys(d.keys)))
    ),
    connector: (target) =>
      opened.pipe(
        Effect.mapError(
          (error) =>
            new ConnectFailure({
              kind: "transient",
              reason: "connection-failed",
              detail: error.message,
            })
        ),
        Effect.flatMap((d) => relayConnector(d)(target))
      ),
    close: () => {
      void device?.then((d) => d.close()).catch(() => {});
    },
  };
};

import { expect, test } from "bun:test";
import { HostTarget } from "@polaris/client";
import { relayAddress } from "@polaris/protocol/relay";
import { deviceKeys, devicePublicKeys, generateDeviceSecrets } from "@polaris/client/relay";
import { Effect, Option } from "effect";
import { desktopRelayDevice, loadRelayDeviceSecrets, RELAY_DEVICE_KEY } from "./relayDevice.ts";
import { SecureStorage } from "./secure/index.ts";

const memoryStorage = () =>
  Effect.runSync(
    Effect.provide(
      SecureStorage.useSync((storage) => storage),
      SecureStorage.memory
    )
  );

test("the relay identity is made once and kept, so Hosts that admitted this app still know it", async () => {
  const storage = memoryStorage();
  const first = await Effect.runPromise(desktopRelayDevice(storage).publicKeys);
  const again = await Effect.runPromise(desktopRelayDevice(storage).publicKeys);

  expect(again).toEqual(first);

  const stored = Option.getOrThrow(Effect.runSync(storage.get(RELAY_DEVICE_KEY)));

  const secrets = await Effect.runPromise(
    Effect.provideService(loadRelayDeviceSecrets(generateDeviceSecrets), SecureStorage, storage)
  );

  expect(devicePublicKeys(await deviceKeys(secrets))).toEqual(first);
  expect(Effect.runSync(storage.get(RELAY_DEVICE_KEY))).toEqual(Option.some(stored));
});

test("a stored identity that won't decode is refused, never replaced", async () => {
  const storage = memoryStorage();
  Effect.runSync(storage.set(RELAY_DEVICE_KEY, "not json"));

  const failure = await Effect.runPromise(Effect.flip(desktopRelayDevice(storage).publicKeys));

  expect(failure.message).toBe("the stored relay identity is corrupt");
  expect(Effect.runSync(storage.get(RELAY_DEVICE_KEY))).toEqual(Option.some("not json"));
});

test("a Relay Host is unreachable, not broken, while the identity can't load", async () => {
  const storage = Effect.runSync(
    Effect.provide(
      SecureStorage.useSync((s) => s),
      SecureStorage.unavailable("no-backend")
    )
  );

  const hostAddress = await relayAddress(new Uint8Array(32));

  const failure = await Effect.runPromise(
    Effect.scoped(
      Effect.flip(
        desktopRelayDevice(storage).connector(
          HostTarget.Relay({ relayUrl: "ws://127.0.0.1:1/v1", hostAddress, hostNoiseKey: "" })
        )
      )
    )
  );

  expect(failure.kind).toBe("transient");
  expect(failure.detail).toBe("no secret store on this machine");
});

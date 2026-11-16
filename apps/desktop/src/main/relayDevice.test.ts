import { expect, test } from "bun:test";
import { HostTarget } from "@polaris/client";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relayAddress, toBase64Url } from "@polaris/protocol/relay";
import { deviceKeys, devicePublicKeys, generateDeviceSecrets } from "@polaris/client/relay";
import { Effect, Option } from "effect";
import { desktopRelayDevice, loadRelayDeviceSecrets, RELAY_DEVICE_KEY } from "./relayDevice.ts";
import { LEGACY_PROOF_FILE } from "./languages/credential.ts";
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

const noStore = () =>
  Effect.runSync(
    Effect.provide(
      SecureStorage.useSync((s) => s),
      SecureStorage.unavailable("no-backend")
    )
  );

test("without a secret store the identity lives in an owner-only file, kept across launches", async () => {
  const userData = mkdtempSync(join(tmpdir(), "polaris-relay-"));

  try {
    const file = {
      fileDirectory: join(userData, "relay-device-private"),
      platform: "linux",
    } as const;

    const first = await Effect.runPromise(desktopRelayDevice(noStore(), { file }).publicKeys);
    const again = await Effect.runPromise(desktopRelayDevice(noStore(), { file }).publicKeys);

    expect(again).toEqual(first);
    expect(first.noiseKey).not.toBe(toBase64Url(new Uint8Array(32)));
    expect(statSync(join(file.fileDirectory, LEGACY_PROOF_FILE)).mode & 0o777).toBe(0o600);

    // On Windows there is no such file: no store means no identity, as for the user key.
    const windows = await Effect.runPromise(
      Effect.flip(
        desktopRelayDevice(noStore(), { file: { ...file, platform: "win32" } }).publicKeys
      )
    );

    expect(windows.message).toBe("no secret store on this machine");
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

test("a Relay Host is unreachable, not broken, while the identity can't load", async () => {
  const storage = noStore();

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

/** The idle bench's fixture: one Linked Device with a Live Activity registered, written while no Daemon runs. */
import { join } from "node:path";
import { RelayAddress, toBase64Url } from "@polaris/protocol/relay";
import { Effect, Schema } from "effect";
import { LinkedDevices } from "../linkedDevices/store.ts";
import { pushSuite } from "./seal.ts";

export const seedLiveActivity = Effect.fnUntraced(function* () {
  const store = yield* LinkedDevices;
  const keys = yield* Effect.promise(() => pushSuite.kem.generateKeyPair());
  const raw = yield* Effect.promise(() => pushSuite.kem.serializePublicKey(keys.publicKey));

  const device = yield* store.add({
    name: "Bench phone",
    relayAddress: Schema.decodeSync(RelayAddress)("B".repeat(22)),
    noiseKey: "A".repeat(43),
  });

  // The ticket isn't checked here: the bench measures the notifier, not registration.
  yield* store.setLive(device.id, {
    token: "be".repeat(40),
    environment: "sandbox",
    pushKey: toBase64Url(new Uint8Array(raw)),
    ticket: { key: "A".repeat(43), sig: "A".repeat(86) },
  });

  return store.liveTargets().length;
});

export const seedIdleLiveActivity = (home: string) =>
  Effect.scoped(
    seedLiveActivity().pipe(
      Effect.provide(LinkedDevices.layer(join(home, "linked-devices.sqlite")))
    )
  );

if (import.meta.main) {
  const home = process.argv[2];

  if (home === undefined) throw new Error("supply the benchmark temporary home");
  console.log(await Effect.runPromise(seedIdleLiveActivity(home)));
}

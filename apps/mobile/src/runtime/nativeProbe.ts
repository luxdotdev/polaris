/**
 * The simulator check (scripts/simulatorCheck.ts): on the app's own Hermes and the native
 * libsodium module, runs the Noise checks, then links through a real relay with a link
 * string and calls a Client-only RPC on the Host. Prints one `POLARIS_NATIVE_CHECK` line.
 */
import {
  deviceKeys,
  generateDeviceSecrets,
  linkDevice,
  makeRelayDevice,
  readLink,
} from "@polaris/client/relay";
import { Effect } from "effect";
import { type CheckResult, runNoiseChecks } from "../sodium/noiseCheck.ts";
import { openHostConnection } from "./hostConnection.ts";

const MARKER = "POLARIS_NATIVE_CHECK ";

const LINKED = "linked through the relay with Client power";

const linkAndCall = async (linkString: string): Promise<CheckResult> => {
  const keys = await deviceKeys(generateDeviceSecrets());

  const linked = await Effect.runPromise(
    Effect.flatMap(readLink(linkString), (envelope) =>
      linkDevice(envelope, keys, "Simulator")
    ).pipe(
      Effect.map((hosts) => ({ hosts, failed: null })),
      Effect.catchTag("LinkFailed", (failure) =>
        Effect.succeed({ hosts: [], failed: failure.message })
      )
    )
  );

  if (linked.failed !== null) return { name: LINKED, ok: false, detail: linked.failed };

  const [host] = linked.hosts;

  if (host === undefined) return { name: "link", ok: false, detail: "the link named no Host" };

  const device = makeRelayDevice(keys);

  const connection = openHostConnection({
    hostId: host.hostId,
    name: host.hostName,
    transport: { route: "relay", open: device.transport(host) },
  });

  try {
    const deadline = Date.now() + 30_000;

    while (connection.live() === null) {
      if (Date.now() > deadline) return { name: "link", ok: false, detail: "never connected" };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const devices = await connection.run((client) => client["devices.list"]());
    const listed = devices.some((linked) => linked.relayAddress === keys.address);

    return {
      name: LINKED,
      ok: listed,
      detail: listed ? "ok" : "devices.list does not name this device",
    };
  } finally {
    await connection.close();
    device.close();
  }
};

export const runNativeProbe = async (linkString: string | null): Promise<void> => {
  const results: Array<CheckResult> = [...(await runNoiseChecks())];

  if (linkString !== null)
    results.push(
      await linkAndCall(linkString).catch(() => ({
        name: LINKED,
        ok: false,
        detail: "the relay connection failed",
      }))
    );

  console.log(MARKER + JSON.stringify(results));
};

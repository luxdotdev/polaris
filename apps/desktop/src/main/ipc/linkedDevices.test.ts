import { describe, expect, test } from "bun:test";
import type { HostConnection, LiveSession } from "@polaris/client";
import {
  type Capability,
  decodeLinkString,
  encodeLinkString,
  HostId,
  LinkedDevice,
  LinkedDeviceId,
  RelayRouteError,
  RelayRouteStatus,
} from "@polaris/protocol";
import { relayAddress } from "@polaris/protocol/relay";
import { Effect, Exit, Layer, Option, SubscriptionRef } from "effect";
import type { HostView } from "../../shared/api.ts";
import { HostDirectory, UnknownHost } from "../hosts.ts";
import { linkedDevicesHandlers } from "./linkedDevices.ts";

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

const address = () => relayAddress(crypto.getRandomValues(new Uint8Array(32)));

interface FakeHost {
  readonly key: string;
  readonly label: string;
  readonly route: RelayRouteStatus;
  readonly capabilities?: ReadonlyArray<Capability>;
  /** `devices.add` fails on this Host. */
  readonly refusesAdd?: boolean;
}

const route = async (state: "on" | "off", connected = state === "on") =>
  new RelayRouteStatus({
    state,
    url: state === "on" ? "wss://relay.example/v1" : null,
    connected,
    hostAddress: await address(),
    hostNoiseKey: key(),
  });

const phone = async () =>
  new LinkedDevice({
    id: LinkedDeviceId.make("d1"),
    name: "Lucas's iPhone",
    relayAddress: await address(),
    noiseKey: key(),
    createdAt: "2026-10-27T12:00:00.000Z",
    lastUsedAt: null,
    unlinkedAt: null,
  });

/** Hosts in list order, each answering the Linked Device RPCs; `added` records `devices.add`. */
const directory = (hosts: ReadonlyArray<FakeHost>, device: LinkedDevice, added: Array<string>) => {
  const client = (host: FakeHost, hostId: HostId) => ({
    "relayRoute.status": () => Effect.succeed(host.route),
    "devices.link": () =>
      Effect.succeed({
        linkId: "link-1",
        expiresAt: "2026-10-27T12:05:00.000Z",
        linkString: encodeLinkString({
          hostId,
          hostName: "daemon-hostname",
          relayUrl: host.route.url ?? "",
          hostAddress: host.route.hostAddress,
          hostNoiseKey: host.route.hostNoiseKey,
          secret: key(),
          expiresAt: "2026-10-27T12:05:00.000Z",
        }),
      }),
    "devices.awaitLink": () => Effect.succeed(device),
    "devices.add": () => {
      if (host.refusesAdd === true)
        return Effect.fail(new RelayRouteError({ reason: "failed", message: "no" }));
      added.push(host.key);

      return Effect.succeed(device);
    },
  });

  const session = (host: FakeHost, hostId: HostId): Partial<LiveSession> => ({
    capabilities: host.capabilities ?? ["linked-devices"],
    // SAFETY: the handlers read only `hostId` of the HostInfo.
    host: { hostId } as LiveSession["host"],
    // SAFETY: the handlers call only the Linked Device RPCs faked in `client`.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- a partial fake of a generic RPC client
    client: client(host, hostId) as unknown as LiveSession["client"],
  });

  const views = hosts.map((host): HostView => ({
    key: host.key,
    label: host.label,
    colour: null,
    alias: null,
    kind: "ssh",
    proofHarness: false,
    // SAFETY: the handlers read only the key and label of a view.
    status: {} as HostView["status"],
  }));

  return Layer.effect(
    HostDirectory,
    Effect.map(SubscriptionRef.make<ReadonlyArray<HostView>>(views), (ref) =>
      HostDirectory.of({
        views: ref,
        entry: () => undefined,
        connection: (k) => {
          const host = hosts.find((h) => h.key === k);

          if (host === undefined) return Effect.fail(new UnknownHost(k));
          // SAFETY: the handlers read only the fields `session` fakes.
          const live = session(host, HostId.make(`id-${k}`)) as LiveSession;
          const connection: Partial<HostConnection> = { session: Effect.succeed(live) };

          // SAFETY: the handlers read only `session` of a connection.
          return Effect.succeed(connection as HostConnection);
        },
        add: () => Effect.void,
        remove: () => Effect.void,
      })
    )
  );
};

const run = <A, E>(effect: Effect.Effect<A, E, HostDirectory>, layer: Layer.Layer<HostDirectory>) =>
  Effect.runPromiseExit(Effect.provide(effect, layer));

describe("linking a device", () => {
  test("links through the first connected Host with the relay on and shares to the others on it", async () => {
    const hosts: ReadonlyArray<FakeHost> = [
      { key: "local", label: "MacBook Pro", route: await route("off") },
      { key: "studio", label: "Mac Studio", route: await route("on") },
      { key: "pi", label: "Raspberry Pi 4", route: await route("on", false) },
      { key: "old", label: "Old iMac", route: await route("on"), capabilities: [] },
    ];

    const layer = directory(hosts, await phone(), []);

    const offer = await Effect.runPromise(
      Effect.provide(linkedDevicesHandlers["devices.startLink"](), layer)
    );

    expect(offer.hostKey).toBe("studio");
    expect(offer.shareTo).toEqual(["pi"]);
    const envelope = Option.getOrThrow(decodeLinkString(offer.linkString));
    expect(envelope.link.hostName).toBe("Mac Studio");
    expect(envelope.hosts.map((h) => h.hostName)).toEqual(["Raspberry Pi 4"]);
  });

  test("with no Host on the relay, it says to turn the relay on", async () => {
    const layer = directory(
      [{ key: "local", label: "MacBook Pro", route: await route("off") }],
      await phone(),
      []
    );

    const exit = await run(linkedDevicesHandlers["devices.startLink"](), layer);

    expect(exit).toEqual(
      Exit.fail({
        code: "NoRelayHost",
        message: "Turn on the Polaris Relay for a host to link a device.",
      })
    );
  });

  test("once linked, the device is added to every other Host, and a refusal is reported per Host", async () => {
    const added: Array<string> = [];
    const device = await phone();

    const hosts: ReadonlyArray<FakeHost> = [
      { key: "studio", label: "Mac Studio", route: await route("on") },
      { key: "pi", label: "Raspberry Pi 4", route: await route("on") },
      { key: "vm", label: "Linux VM", route: await route("on"), refusesAdd: true },
    ];

    const exit = await run(
      linkedDevicesHandlers["devices.finishLink"]({
        hostKey: "studio",
        linkId: "link-1",
        shareTo: ["pi", "vm"],
      }),
      directory(hosts, device, added)
    );

    expect(exit).toEqual(
      Exit.succeed({
        device,
        shares: [
          { hostKey: "pi", ok: true },
          { hostKey: "vm", ok: false },
        ],
      })
    );
    expect(added).toEqual(["pi"]);
  });
});

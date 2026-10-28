/**
 * Settings → Devices and the Polaris Relay route (ENG-461). Linking runs here so the
 * link string only crosses IPC once, to the QR code; nothing here logs it.
 */
import type { LiveSession } from "@polaris/client";
import { Effect, Option, SubscriptionRef } from "effect";
import type { RequestInput } from "../../shared/contract.ts";
import type { IpcError } from "../../shared/api.ts";
import { HostDirectory, toIpcError } from "../hosts.ts";
import { linkEnvelope, reachable, type RelayHost } from "../linkedDevices/envelope.ts";

const sessionOf = (hostKey: string) =>
  HostDirectory.use((dir) => dir.connection(hostKey)).pipe(Effect.flatMap((c) => c.session));

const onHost = <A, E extends { readonly _tag: string; readonly message: string }>(
  hostKey: string,
  call: (session: LiveSession) => Effect.Effect<A, E>
) => sessionOf(hostKey).pipe(Effect.flatMap(call), Effect.mapError(toIpcError));

const noRelay: IpcError = {
  code: "NoRelayHost",
  message: "Turn on the Polaris Relay for a host to link a device.",
};

/** Every connected Host with Linked Devices, in the Host list's order, with its route. */
const relayHosts = Effect.gen(function* () {
  const dir = yield* HostDirectory;
  const views = yield* SubscriptionRef.get(dir.views);

  const hosts = yield* Effect.forEach(views, (view) =>
    sessionOf(view.key).pipe(
      Effect.flatMap((session) =>
        session.capabilities.includes("linked-devices")
          ? Effect.map(session.client["relayRoute.status"](), (route) =>
              Option.some({
                host: { key: view.key, label: view.label, hostId: session.host.hostId, route },
                session,
              })
            )
          : Effect.succeedNone
      ),
      Effect.orElseSucceed(() => Option.none<{ host: RelayHost; session: LiveSession }>())
    )
  );

  return hosts.flatMap(Option.toArray);
});

const startLink = Effect.gen(function* () {
  const hosts = yield* relayHosts;
  const through = hosts.find((h) => reachable(h.host) && h.host.route.connected);

  if (through === undefined) return yield* Effect.fail(noRelay);

  const offer = yield* through.session.client["devices.link"]().pipe(Effect.mapError(toIpcError));
  const all = hosts.map((h) => h.host);

  const linkString = yield* Option.match(linkEnvelope(offer.linkString, through.host, all), {
    onNone: () =>
      Effect.fail<IpcError>({ code: "InvalidLink", message: "The host's link was not a link." }),
    onSome: Effect.succeed,
  });

  return {
    hostKey: through.host.key,
    linkId: offer.linkId,
    linkString,
    expiresAt: offer.expiresAt,
    shareTo: all.filter((h) => h.key !== through.host.key && reachable(h)).map((h) => h.key),
  };
});

const finishLink = ({ hostKey, linkId, shareTo }: RequestInput<"devices.finishLink">) =>
  Effect.gen(function* () {
    const device = yield* onHost(hostKey, (s) => s.client["devices.awaitLink"]({ linkId }));

    const shares = yield* Effect.forEach(
      shareTo,
      (key) =>
        onHost(key, (s) =>
          s.client["devices.add"]({
            name: device.name,
            relayAddress: device.relayAddress,
            noiseKey: device.noiseKey,
          })
        ).pipe(
          Effect.as({ hostKey: key, ok: true }),
          Effect.orElseSucceed(() => ({ hostKey: key, ok: false }))
        ),
      { concurrency: "unbounded" }
    );

    return { device, shares };
  });

export const linkedDevicesHandlers = {
  "relayRoute.status": ({ hostKey }: RequestInput<"relayRoute.status">) =>
    onHost(hostKey, (s) => s.client["relayRoute.status"]()),
  "relayRoute.enable": ({ hostKey, url }: RequestInput<"relayRoute.enable">) =>
    onHost(hostKey, (s) => s.client["relayRoute.enable"]({ url })),
  "relayRoute.disable": ({ hostKey }: RequestInput<"relayRoute.disable">) =>
    onHost(hostKey, (s) => s.client["relayRoute.disable"]()),
  "devices.list": ({ hostKey }: RequestInput<"devices.list">) =>
    onHost(hostKey, (s) => s.client["devices.list"]()),
  "devices.startLink": () => startLink,
  "devices.finishLink": finishLink,
  "devices.share": ({ hostKey, ...device }: RequestInput<"devices.share">) =>
    onHost(hostKey, (s) => s.client["devices.add"](device)),
  "devices.unlink": ({ hostKey, id }: RequestInput<"devices.unlink">) =>
    onHost(hostKey, (s) => s.client["devices.unlink"]({ id })),
};

/**
 * Linking a device once (ADR 0083): dial the link's relay with the throwaway identity
 * its secret gives, and handshake with the Host carrying a proof of the secret, the
 * device's relay address and its name. Never log the link string: it holds the secret.
 */
import { decodeLinkString, encodeLinkRequest, type LinkEnvelope } from "@polaris/protocol";
import { fromBase64Url, secureRelayUrl, toBase64Url } from "@polaris/protocol/relay";
import { linkIdentity, linkProof } from "@polaris/protocol/relay/party";
import { Effect, Option, Schema } from "effect";
import type { DeviceKeys, LinkedHost } from "./device.ts";
import { openSession } from "./session.ts";
import { RelaySocket } from "./socket.ts";

export class LinkFailed extends Schema.TaggedError<LinkFailed>()("LinkFailed", {
  reason: Schema.Literals(["not-a-link", "expired", "no-answer", "insecure-relay", "host-changed"]),
  message: Schema.String,
}) {}

export { secureRelayUrl };

/** The link string's envelope; LinkFailed when the text isn't one or names a relay without TLS. */
export const readLink = (text: string): Effect.Effect<LinkEnvelope, LinkFailed> =>
  Option.match(decodeLinkString(text), {
    onNone: () =>
      Effect.fail(new LinkFailed({ reason: "not-a-link", message: "That isn't a Polaris link." })),
    onSome: (envelope) =>
      [envelope.link, ...envelope.hosts].every((host) => secureRelayUrl(host.relayUrl))
        ? Effect.succeed(envelope)
        : Effect.fail(
            new LinkFailed({
              reason: "insecure-relay",
              message: "This link names a relay without TLS (wss://), so it wasn't used.",
            })
          ),
  });

/**
 * The Hosts a link names, refused when one is already linked with another key, address or relay:
 * a forged code can't take over a Host this device trusts.
 */
export const checkLinkedHosts = (
  linked: ReadonlyArray<LinkedHost>,
  named: ReadonlyArray<LinkedHost>
): Effect.Effect<ReadonlyArray<LinkedHost>, LinkFailed> => {
  const changed = named.find((host) =>
    linked.some(
      (known) =>
        known.hostId === host.hostId &&
        (known.hostNoiseKey !== host.hostNoiseKey ||
          known.hostAddress !== host.hostAddress ||
          known.relayUrl !== host.relayUrl)
    )
  );

  return changed === undefined
    ? Effect.succeed(named)
    : Effect.fail(
        new LinkFailed({
          reason: "host-changed",
          message: `${changed.hostName} is already linked with another key, so this link wasn't used.`,
        })
      );
};

/** Every Host the link names: the one the device links through first, then the others. */
export const linkedHosts = (envelope: LinkEnvelope): ReadonlyArray<LinkedHost> =>
  [envelope.link, ...envelope.hosts].map((host) => ({
    hostId: host.hostId,
    hostName: host.hostName,
    relayUrl: host.relayUrl,
    hostAddress: host.hostAddress,
    hostNoiseKey: host.hostNoiseKey,
  }));

/**
 * Links the device through the envelope's Host and resolves with every Host it names.
 * The other Hosts answer once the Desktop App shared the device to them (`devices.add`).
 */
export const linkDevice = Effect.fn("linkDevice")(function* (
  envelope: LinkEnvelope,
  keys: DeviceKeys,
  name: string
) {
  const { link } = envelope;

  if (Date.parse(link.expiresAt) <= Date.now())
    return yield* new LinkFailed({
      reason: "expired",
      message: "This link expired. Make a new one in the Desktop App.",
    });

  const secret = Option.getOrNull(fromBase64Url(link.secret));
  const hostNoiseKey = Option.getOrNull(fromBase64Url(link.hostNoiseKey));

  if (secret === null || hostNoiseKey === null)
    return yield* new LinkFailed({ reason: "not-a-link", message: "That isn't a Polaris link." });

  const request = encodeLinkRequest({
    v: 1,
    address: keys.address,
    name,
    proof: toBase64Url(linkProof(secret, keys.noise.publicKey, keys.address)),
  });

  const socket = new RelaySocket({
    url: link.relayUrl,
    identity: linkIdentity(secret),
    reconnect: false,
  });

  yield* Effect.tryPromise({
    try: () =>
      openSession(
        socket,
        { address: link.hostAddress, noiseKey: hostNoiseKey },
        keys.noise,
        new TextEncoder().encode(request)
      ),
    catch: () =>
      new LinkFailed({
        reason: "no-answer",
        message: `${link.hostName} didn't answer. The link may be used or expired, or the Host is offline.`,
      }),
  }).pipe(Effect.ensuring(Effect.sync(() => socket.stop())));

  return linkedHosts(envelope);
});

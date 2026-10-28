/**
 * The QR code's link (ENG-461, Q16): the linking Host's one-time link wrapped in a
 * `polaris-link:v2` envelope with every other Host whose Relay route is on,
 * so the phone links once and reaches them all. Names are this app's Host labels.
 */
import {
  decodeLinkString,
  encodeLinkEnvelope,
  type HostId,
  type RelayRouteStatus,
  type SharedHost,
} from "@polaris/protocol";
import { Option } from "effect";

export interface RelayHost {
  readonly key: string;
  readonly label: string;
  readonly hostId: HostId;
  readonly route: Pick<
    RelayRouteStatus,
    "state" | "url" | "connected" | "hostAddress" | "hostNoiseKey"
  >;
}

/** On with a relay URL; a Host whose relay socket is down still takes the device and catches up. */
export const reachable = (host: RelayHost): boolean =>
  host.route.state === "on" && host.route.url !== null;

const shared = (host: RelayHost): SharedHost => ({
  hostId: host.hostId,
  hostName: host.label,
  relayUrl: host.route.url ?? "",
  hostAddress: host.route.hostAddress,
  hostNoiseKey: host.route.hostNoiseKey,
});

/**
 * The v2 link string for `linkString` (from `through`'s `devices.link`), or none when it
 * isn't a link. Hosts that can't be reached, and `through` itself, are left out.
 */
export const linkEnvelope = (
  linkString: string,
  through: RelayHost,
  hosts: ReadonlyArray<RelayHost>
): Option.Option<string> =>
  Option.map(decodeLinkString(linkString), ({ link }) =>
    encodeLinkEnvelope({
      link: { ...link, hostName: through.label },
      hosts: hosts.flatMap((h) => (h.key !== through.key && reachable(h) ? [shared(h)] : [])),
    })
  );

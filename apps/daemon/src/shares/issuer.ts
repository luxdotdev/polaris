/**
 * What the Host asks a Share's issuer (apps/accounts/README.md is the contract): the devices
 * that accepted its Invite, as a long-poll with an ETag, and the end of its capability. Both
 * carry `Authorization: Capability <hostCapability>`.
 */
import { PersonId } from "@polaris/protocol";
import { RelayAddress } from "@polaris/protocol/relay";
import { Option, Schema } from "effect";
import type { Fetch } from "./statement.ts";

/** A device that accepted the Invite, with the issuer's current statement for it. */
export const IssuerDevice = Schema.Struct({
  personId: PersonId,
  relayAddress: RelayAddress,
  noiseKey: Schema.String,
  statement: Schema.String,
});

export type IssuerDevice = typeof IssuerDevice.Type;

export const DevicesAnswer = Schema.TaggedUnion({
  Devices: { etag: Schema.NullOr(Schema.String), devices: Schema.Array(IssuerDevice) },
  /** 304: the list is as the ETag had it. */
  Unchanged: {},
  /** 401 or 404: the issuer no longer knows the Invite or the capability. */
  Gone: {},
  Unreachable: {},
});

export type DevicesAnswer = typeof DevicesAnswer.Type;

const decodeList = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));

const decodeDevice = Schema.decodeUnknownOption(IssuerDevice);

/** How long past the long-poll's `wait` the Host gives the issuer to answer. */
const ANSWER_GRACE_MS = 15_000;

export interface DevicesRequest {
  readonly issuer: string;
  readonly inviteId: string;
  readonly capability: string;
  readonly etag: string | null;
  /** Seconds the issuer may hold the request; 0 answers at once. */
  readonly waitS: number;
  readonly signal?: AbortSignal | undefined;
}

const devicesUrl = (issuer: string, inviteId: string) =>
  `${issuer}/v1/shares/${encodeURIComponent(inviteId)}/devices`;

const read = async (response: Response): Promise<DevicesAnswer> => {
  if (response.status === 304) return DevicesAnswer.cases.Unchanged.make({});

  if (response.status === 401 || response.status === 404) return DevicesAnswer.cases.Gone.make({});

  if (!response.ok) return DevicesAnswer.cases.Unreachable.make({});
  const list = Option.getOrNull(decodeList(await response.json()));

  if (list === null) return DevicesAnswer.cases.Unreachable.make({});

  // A device the Host can't read is left out; the rest of the list still stands.
  return DevicesAnswer.cases.Devices.make({
    etag: response.headers.get("etag"),
    devices: list.flatMap((entry) => Option.toArray(decodeDevice(entry))),
  });
};

/** The Invite's accepted devices; never throws. */
export const fetchDevices = async (
  request: Fetch,
  options: DevicesRequest
): Promise<DevicesAnswer> => {
  const timeout = AbortSignal.timeout(options.waitS * 1000 + ANSWER_GRACE_MS);
  const headers = new Headers({ authorization: `Capability ${options.capability}` });

  if (options.etag !== null) headers.set("if-none-match", options.etag);

  try {
    return await read(
      await request(`${devicesUrl(options.issuer, options.inviteId)}?wait=${options.waitS}`, {
        redirect: "error",
        headers,
        signal: options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]),
      })
    );
  } catch {
    return DevicesAnswer.cases.Unreachable.make({});
  }
};

/** Ends the capability at the issuer, so the Invite can no longer be accepted; best effort. */
export const revokeCapability = async (
  request: Fetch,
  options: Pick<DevicesRequest, "issuer" | "inviteId" | "capability">
): Promise<void> => {
  try {
    await request(devicesUrl(options.issuer, options.inviteId), {
      method: "DELETE",
      redirect: "error",
      headers: { authorization: `Capability ${options.capability}` },
      signal: AbortSignal.timeout(ANSWER_GRACE_MS),
    });
  } catch {
    // The Share is revoked on the Host either way.
  }
};

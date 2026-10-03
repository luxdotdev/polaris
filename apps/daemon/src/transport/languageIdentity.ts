import { createHash, timingSafeEqual } from "node:crypto";
import {
  LanguageIdentityError,
  type HostId,
  type LanguageConnectionIdentity,
} from "@polaris/protocol";
import { Context, Option, Redacted, Schema } from "effect";
import type { Rpc } from "effect/rpc";

export class LanguageConnectionAuthority extends Context.Service<
  LanguageConnectionAuthority,
  LanguageConnectionIdentity | null
>()("polaris/daemon/LanguageConnectionAuthority") {}

interface Binding {
  readonly hostId: HostId;
  readonly digest: Buffer | null;
  readonly identity: LanguageConnectionIdentity | null;
  revoked: boolean;
}

const bindings = new WeakMap<Rpc.ServerClient, Binding>();

const failure = () => new LanguageIdentityError({ message: "Language identity unavailable" });

const digestOf = (hostId: HostId, proof: Redacted.Redacted<unknown>): Buffer => {
  const value = Schema.decodeUnknownOption(Schema.String)(Redacted.value(proof));

  if (Option.isNone(value) || !/^[a-f0-9]{64}$/.test(value.value)) throw failure();

  return createHash("sha256")
    .update(JSON.stringify(["polaris-language-client-v1", hostId, value.value]))
    .digest();
};

/** Lock the first hello to this actual RPC connection, including a missing proof. */
export const bindLanguageIdentity = (
  client: Rpc.ServerClient,
  hostId: HostId,
  proof?: Redacted.Redacted<unknown>
): LanguageConnectionIdentity | null => {
  const previous = bindings.get(client);
  let digest: Buffer | null;

  try {
    digest = proof === undefined ? null : digestOf(hostId, proof);
  } catch {
    if (previous !== undefined) previous.revoked = true;
    else bindings.set(client, { hostId, digest: null, identity: null, revoked: true });
    client.annotate(LanguageConnectionAuthority, null);
    throw failure();
  }

  if (previous !== undefined) {
    const same =
      previous.digest === null
        ? digest === null
        : digest !== null && timingSafeEqual(previous.digest, digest);

    if (previous.revoked || previous.hostId !== hostId || !same) {
      previous.revoked = true;
      client.annotate(LanguageConnectionAuthority, null);
      throw failure();
    }

    return previous.identity;
  }

  const identity =
    digest === null
      ? null
      : Object.freeze({ hostId, clientId: `language-${digest.toString("hex")}` });

  bindings.set(client, { hostId, digest, identity, revoked: false });
  client.annotate(LanguageConnectionAuthority, identity);

  return identity;
};

/** Read authority from the actual handler connection, never from request fields. */
export const languageIdentityFor = (
  client: Rpc.ServerClient,
  hostId: HostId
): LanguageConnectionIdentity | null => {
  const binding = bindings.get(client);

  return binding === undefined || binding.revoked || binding.hostId !== hostId
    ? null
    : binding.identity;
};

/** G2's actual connection finalizer must revoke retained handler authority on closure. */
export const revokeLanguageIdentity = (client: Rpc.ServerClient): void => {
  const binding = bindings.get(client);

  if (binding !== undefined) binding.revoked = true;
  client.annotate(LanguageConnectionAuthority, null);
};

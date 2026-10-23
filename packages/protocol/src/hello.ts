/**
 * `hello`: the first RPC on every connection. It names the Client, negotiates
 * capabilities, and optionally presents a language proof or an Extension token.
 */
import { Schema } from "effect";
import { Rpc } from "effect/rpc";
import { CapabilityList } from "./capabilities.ts";
import { HostInfo } from "./domain.ts";
import { ExtensionTokenRejected } from "./extensions.ts";
import { HostId } from "./ids.ts";

export const LanguageConnectionIdentity = Schema.Struct({
  hostId: HostId,
  clientId: Schema.String,
});

export type LanguageConnectionIdentity = typeof LanguageConnectionIdentity.Type;

export class LanguageIdentityError extends Schema.TaggedError<LanguageIdentityError>()(
  "LanguageIdentityError",
  { message: Schema.Literal("Language identity unavailable") }
) {}

export const Hello = Rpc.make("hello", {
  payload: {
    clientName: Schema.String,
    clientVersion: Schema.String,
    /** Label shown to other Clients, e.g. when this device resolves an approval. */
    deviceLabel: Schema.String,
    capabilities: CapabilityList,
    /** Private bearer proof; malformed values stay redacted until safe handler validation. */
    languageProof: Schema.optionalKey(Schema.RedactedFromValue(Schema.Unknown)),
    /**
     * A Pairing's token (`pol_ext_…`): the connection is then scoped to that Pairing's Grant
     * and acts as the Extension (ADR 0078). Without it the Client keeps full power.
     */
    extensionToken: Schema.optionalKey(Schema.RedactedFromValue(Schema.String)),
  },
  success: Schema.Struct({
    host: HostInfo,
    protocolVersion: Schema.Int,
    capabilities: CapabilityList,
    languageIdentity: Schema.optionalKey(LanguageConnectionIdentity),
  }),
  error: Schema.Union([LanguageIdentityError, ExtensionTokenRejected]),
});

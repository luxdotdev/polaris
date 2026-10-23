/**
 * The errors the SDK fails with. Refusals from the Daemon keep the protocol's
 * own types (`NotGranted` names the missing Grant); the rest happen on this side.
 */
import { Schema } from "effect";

export {
  CommandRejected,
  ExtensionTokenRejected,
  NotFound,
  NotGranted,
  ProtocolMismatch,
  VoiceError,
} from "@polaris/protocol";

/** The Host could not be reached on any of its Pairings, or the connection was lost. */
export class HostUnreachable extends Schema.TaggedError<HostUnreachable>()("HostUnreachable", {
  hostId: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Can't reach Host ${this.hostId}: ${this.detail}`;
  }
}

/** No Pairing names this Host. */
export class UnknownHost extends Schema.TaggedError<UnknownHost>()("UnknownHost", {
  hostId: Schema.String,
}) {
  override get message(): string {
    return `No pairing for Host ${this.hostId}`;
  }
}

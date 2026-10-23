/** One line for the glasses saying what went wrong and what to do. */
import {
  CommandRejected,
  ExtensionTokenRejected,
  HostUnreachable,
  InvalidPairing,
  NotFound,
  NotGranted,
  ProtocolMismatch,
  VoiceError,
} from "@polaris/sdk";

export const describeError = (cause: unknown, hostName: string): string => {
  const error = cause;

  if (error instanceof NotGranted)
    return error.needed === null
      ? "Extensions can't do that"
      : `Not allowed: pair again with the ${error.needed} grant`;

  if (error instanceof ExtensionTokenRejected)
    return error.reason === "revoked"
      ? `${hostName} revoked this pairing. Pair again on your phone.`
      : `${hostName} doesn't know this pairing. Pair again on your phone.`;

  if (error instanceof HostUnreachable) return `Can't reach ${hostName}`;

  if (error instanceof NotFound) return "Already answered or gone";

  if (error instanceof CommandRejected) return error.reason;

  if (error instanceof VoiceError) return error.message;

  if (error instanceof ProtocolMismatch) return error.message;

  if (error instanceof InvalidPairing) return "That pairing string can't be read";

  return error instanceof Error ? error.message : String(error);
};

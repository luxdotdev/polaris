/** What an agent's Secret Request comes to (ADR 0089), shared by the Engine and the MCP tool. */
import { Data } from "effect";

export type SecretOutcome = Data.TaggedEnum<{
  Saved: { readonly file: string };
  Declined: Record<never, never>;
  TimedOut: Record<never, never>;
  /** The request went away unanswered: the Turn ended or was stopped, or the Daemon restarted. */
  Cancelled: { readonly reason: string };
  /** The session has no Turn in flight to ask on. */
  NoTurn: Record<never, never>;
  NotFound: Record<never, never>;
}>;

export const SecretOutcome = Data.taggedEnum<SecretOutcome>();

export interface SecretRequestInput {
  readonly label: string;
  readonly reason: string;
  readonly placeholder: string | null;
  readonly timeoutMs: number;
}

export const TIMED_OUT = "The request timed out";

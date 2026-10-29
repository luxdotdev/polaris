/**
 * Keeps the Turns one message carries (a session Snapshot, a `session.turns` page) under a
 * frame: a long session's items can pass `MAX_FRAME_BYTES`, which the encoder refuses (ENG-535).
 * The oldest go first; the Client pages them in with `session.turns`.
 */
import { MAX_FRAME_BYTES, TurnDetail } from "@polaris/protocol";
import { Schema } from "effect";

/** What a message's Turns may encode to: half a frame, leaving room for the rest of it. */
export const TURN_BYTES_BUDGET = MAX_FRAME_BYTES / 2;

const encode = Schema.encodeSync(Schema.toCodecJson(TurnDetail));

/** The UTF-8 bytes one Turn takes on the wire. */
export const turnBytes = (detail: TurnDetail): number =>
  Buffer.byteLength(JSON.stringify(encode(detail)));

/**
 * The newest of `details` (oldest first) that fit `budget`, oldest first. The newest is always
 * kept, so a Client still sees where the session is.
 */
export const newestWithin = (
  details: ReadonlyArray<TurnDetail>,
  budget: number = TURN_BYTES_BUDGET,
  size: (detail: TurnDetail) => number = turnBytes
): ReadonlyArray<TurnDetail> => {
  let used = 0;
  let kept = 0;

  for (const detail of details.toReversed()) {
    used += size(detail);

    if (used > budget && kept > 0) break;
    kept += 1;
  }

  return kept === details.length ? details : details.slice(details.length - kept);
};

/**
 * Binds the Engine's `PairingBook` to the Pairing store once the server has built it, so a
 * queued Turn's Extension is checked again as the Turn would start (`engine/queueAccess.ts`).
 */
import { Effect, Layer } from "effect";
import { PairingBook } from "../engine/queueAccess.ts";
import { Pairings } from "./pairings.ts";

export const PairingBookLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const pairings = yield* Pairings;
    const book = yield* PairingBook;

    // A store that can't be read vouches for no Pairing: their queued Turns don't start.
    book.bind(Effect.orElseSucceed(pairings.list, () => []));
  })
);

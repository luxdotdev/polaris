/**
 * A queued Turn's sender is checked again as the Turn would start (ENG-941, README.md here):
 * whoever sent it must still be allowed to send a Turn into the session.
 */
import {
  type Actor,
  isShareLive,
  type Pairing,
  type SessionId,
  type Share,
  shareCovers,
} from "@polaris/protocol";
import { Clock, Context, Effect, Layer, Match, Option } from "effect";
import { ShareBook } from "../shares/identities.ts";
import { constellationOf } from "../shares/shared.ts";
import type { ReadModel } from "../store/model.ts";
import { queueOf } from "../store/queuedTurns.ts";
import type { EngineRuntime } from "./runtime.ts";
import type { BarredTurn } from "./session.inputs.ts";

/** The Host's Pairings for the Engine, built before the Pairing store: null until it is bound. */
export class PairingBook extends Context.Service<
  PairingBook,
  {
    readonly all: Effect.Effect<ReadonlyArray<Pairing> | null>;
    readonly bind: (pairings: Effect.Effect<ReadonlyArray<Pairing> | null>) => void;
  }
>()("polaris/daemon/engine/PairingBook") {
  static readonly layer = Layer.sync(PairingBook, () => {
    let source = Effect.succeed<ReadonlyArray<Pairing> | null>(null);

    return PairingBook.of({
      all: Effect.suspend(() => source),
      bind: (pairings) => {
        source = pairings;
      },
    });
  });
}

/** What the Host knows of who may send; null where it can't tell, which bars nobody. */
export interface Senders {
  readonly shares: ReadonlyArray<Share> | null;
  readonly pairings: ReadonlyArray<Pairing> | null;
  readonly now: number;
}

const teammate = (
  senders: Senders,
  touch: Parameters<typeof shareCovers>[1],
  shareId: string
): string | null => {
  if (senders.shares === null) return null;

  const share = senders.shares.find(
    (s) => s.id === shareId && isShareLive(s, senders.now) && shareCovers(s.target, touch)
  );

  if (share === undefined) return "Their Share ended";

  return share.grant.includes("turn") ? null : "Their Share no longer allows Turns";
};

const extension = (senders: Senders, pairingId: string): string | null => {
  if (senders.pairings === null) return null;
  const pairing = senders.pairings.find((p) => p.id === pairingId);

  if (pairing === undefined || pairing.revokedAt !== null) return "Its Extension was unpaired";

  return pairing.grant.includes("turn") ? null : "Its Extension may no longer send Turns";
};

/** Why `actor` may no longer send a Turn into the session; null when they may. */
const lostAccess = (
  senders: Senders,
  touch: Parameters<typeof shareCovers>[1],
  actor: Actor
): string | null =>
  Match.value(actor).pipe(
    Match.tags({
      Teammate: (a) => teammate(senders, touch, a.shareId),
      Extension: (a) => extension(senders, a.pairingId),
    }),
    Match.orElse(() => null)
  );

/** The session's queued Turns whose sender lost the access they queued with, each with why. */
export const barredTurns = (
  model: ReadModel,
  sessionId: SessionId,
  senders: Senders
): ReadonlyArray<BarredTurn> => {
  const record = model.sessions.get(sessionId);

  if (record === undefined) return [];
  const touch = { sessionId, constellationId: constellationOf(model, sessionId) };

  return queueOf(record).flatMap((queued) => {
    const reason = lostAccess(senders, touch, queued.actor);

    return reason === null ? [] : [{ turnId: queued.id, reason }];
  });
};

/** `barredTurns` now, from the Shares and Pairings the Host has (either may be absent in tests). */
export const queueAccess = (
  store: EngineRuntime["Service"]["store"],
  shares: Option.Option<ShareBook["Service"]>,
  pairings: Option.Option<PairingBook["Service"]>,
  sessionId: SessionId
) =>
  Effect.gen(function* () {
    const model = yield* store.model;
    const record = model.sessions.get(sessionId);

    if (record === undefined || queueOf(record).length === 0) return [];

    return barredTurns(model, sessionId, {
      shares: Option.isSome(shares) ? yield* shares.value.all : null,
      pairings: Option.isSome(pairings) ? yield* pairings.value.all : null,
      now: yield* Clock.currentTimeMillis,
    });
  });

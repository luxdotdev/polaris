/**
 * Whether an Agent Session is shared right now: a live Share targets it, or the Constellation
 * it leads or works for. A shared session queues Turns sent while one is in flight.
 */
import {
  isShareLive,
  type SessionId,
  type Share,
  type ShareId,
  shareCovers,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { queueOf } from "../store/queuedTurns.ts";
import type { ReadModel } from "../store/model.ts";

/** The Constellation `sessionId` belongs to, as its Lead or a Worker; null without one. */
export const constellationOf = (model: ReadModel, sessionId: SessionId) => {
  const worker = model.sessions.get(sessionId)?.session.worker ?? null;

  if (worker !== null) return worker.constellationId;

  for (const { graph } of model.constellations.values())
    if (graph.leadSessionId === sessionId) return graph.id;

  return null;
};

export const isSessionShared = (
  model: ReadModel,
  shares: ReadonlyArray<Share>,
  sessionId: SessionId,
  now: number
): boolean => {
  if (shares.length === 0) return false;
  const touch = { sessionId, constellationId: constellationOf(model, sessionId) };

  return shares.some((share) => isShareLive(share, now) && shareCovers(share.target, touch));
};

/**
 * The Shares behind a session's queued Turns that no longer cover it (expired, revoked, or
 * not the Host's): a Turn queued through one must not start.
 */
export const endedSharesOf = (
  model: ReadModel,
  shares: ReadonlyArray<Share>,
  sessionId: SessionId,
  now: number
): ReadonlyArray<ShareId> => {
  const record = model.sessions.get(sessionId);

  if (record === undefined) return [];
  const touch = { sessionId, constellationId: constellationOf(model, sessionId) };

  const covers = (id: ShareId) =>
    shares.some((s) => s.id === id && isShareLive(s, now) && shareCovers(s.target, touch));

  return queueOf(record).flatMap(({ actor }) =>
    Predicate.isTagged(actor, "Teammate") && !covers(actor.shareId) ? [actor.shareId] : []
  );
};

/**
 * One review step at a time per Constellation (ADR 0119): a verdict checks that its Inspection
 * is current, merges and commits as one step, and whatever would supersede it waits its turn.
 */
import type { ConstellationCommand, ConstellationId } from "@polaris/protocol";
import { Effect, Predicate, Semaphore } from "effect";
import type { EventStore } from "../../store/EventStore.ts";

type Store = EventStore["Service"];

/** Keyed by the store it serializes, so each Daemon (and each test world) has its own. */
const fences = new WeakMap<Store, Map<ConstellationId, Semaphore.Semaphore>>();

const fenceOf = (store: Store, id: ConstellationId) => {
  const mine = fences.get(store) ?? new Map<ConstellationId, Semaphore.Semaphore>();
  const fence = mine.get(id) ?? Semaphore.makeUnsafe(1);

  fences.set(store, mine);
  mine.set(id, fence);

  return fence;
};

/** Run `effect` alone among the fenced steps of this Constellation in this store. */
export const fenced = <A, E, R>(
  store: Store,
  id: ConstellationId,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => Effect.suspend(() => fenceOf(store, id).withPermits(1)(effect));

/** The commands that record a verdict or can end an Inspection: each prepares inside the fence. */
export const reviewStep = (command: ConstellationCommand) =>
  Predicate.isTagged(command, "Inspect") ||
  Predicate.isTagged(command, "Review") ||
  Predicate.isTagged(command, "WorkerClaim") ||
  Predicate.isTagged(command, "Plan") ||
  Predicate.isTagged(command, "SetState");

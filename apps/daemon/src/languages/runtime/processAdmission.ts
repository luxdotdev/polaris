import { sameProcessCohort } from "./keys.ts";
import { LanguageError } from "@polaris/protocol";
import { Schema } from "effect";
import { failure } from "../transport/framing.ts";
import { bounded } from "../transport/deadline.ts";
import { abortable } from "../install/validation.ts";
import { ProcessBudget, type ProcessReservation } from "./process-budget.ts";
import { deriveProcessLimit, hostProcessResources } from "./process-capacity.ts";
import type { BrokerOptions, Entry } from "./types.ts";
import type { LifecycleEvent } from "./lifecycle.ts";
import type { LaunchAdmissionRequest } from "./launchAdmission.ts";

/** One serialized Host admission lane; process teardown alone releases reservations. */
export function processAdmission(
  options: BrokerOptions,
  entries: Map<string, Entry>,
  move: (entry: Entry, event: LifecycleEvent) => void,
  shutdown: (entry: Entry, reason?: "no-demand" | "process-budget") => Promise<void>
) {
  const budget = new ProcessBudget(
    options.processLimit ?? deriveProcessLimit(hostProcessResources())
  );

  const recency = new WeakMap<Entry, number>();
  const waiting = new Map<Entry, AbortController>();
  const deadline = options.retirementDeadlineMs ?? 10000;
  let clock = 0;
  let tail: Promise<unknown> = Promise.resolve();

  const touch = (entry: Entry) => recency.set(entry, ++clock);
  const cancel = (entry: Entry) => waiting.get(entry)?.abort();

  const retire = (entry: Entry) => {
    cancel(entry);
    budget.retire(entry);
  };

  function idle(entry: Entry) {
    if (!budget.owns(entry) || !entry.lifecycle.can({ type: "evict" }) || entry.operations.size > 0)
      return false;

    return ![...entries.values()].some(
      (peer) => sameProcessCohort(peer, entry) && peer.documents.open.size > 0
    );
  }

  async function admit(entry: Entry, request: LaunchAdmissionRequest, signal: AbortSignal) {
    while (true) {
      if (signal.aborted || !request.isCurrent())
        throw failure("stale-generation", "Language process demand changed");

      if (budget.used < budget.limit) return budget.reserve(entry);

      const victim = [...entries.values()]
        .filter(idle)
        .toSorted((one, two) => (recency.get(one) ?? 0) - (recency.get(two) ?? 0))[0];

      if (victim !== undefined) {
        move(victim, { type: "evict" });
        await abortable(bounded(shutdown(victim, "process-budget"), deadline), signal);
      } else if (budget.retiring) {
        const controller = new AbortController();

        try {
          await bounded(budget.wait(AbortSignal.any([signal, controller.signal])), deadline);
        } finally {
          controller.abort();
        }
      } else return budget.reserve(entry);
    }
  }

  function reserve(entry: Entry, request: LaunchAdmissionRequest) {
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal]);
    waiting.set(entry, controller);
    touch(entry);
    let reservation: ProcessReservation | undefined;

    const task = tail
      .then(() => admit(entry, request, signal))
      .then((value) => {
        reservation = value;

        if (signal.aborted || !request.isCurrent()) {
          value.releaseUnstarted();
          throw failure("stale-generation", "Language process demand changed");
        }

        return value;
      })
      .finally(() => {
        if (waiting.get(entry) === controller) waiting.delete(entry);
      });

    tail = task.catch(() => undefined);

    return abortable(task, signal).catch((cause: unknown) => {
      reservation?.releaseUnstarted();

      if (signal.aborted) throw failure("stale-generation", "Language process demand changed");

      if (Schema.is(LanguageError)(cause) && cause.reason === "timeout")
        throw failure(
          "process-retiring",
          "Language server cleanup has not finished. Try again in a moment."
        );
      throw cause;
    });
  }

  return { budget, reserve, touch, cancel, retire };
}

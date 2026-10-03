import type { Entry } from "./types.ts";
import { failure } from "../transport/framing.ts";

export function enqueue<A>(entry: Entry, operation: () => Promise<A>): Promise<A> {
  if (entry.queued >= 256)
    return Promise.reject(failure("queue-full", "Language command queue full"));
  entry.queued++;
  const result = entry.tail.then(operation);
  entry.tail = result.then(
    () => {},
    () => {}
  );
  void result.finally(() => entry.queued--).catch(() => {});

  return result;
}

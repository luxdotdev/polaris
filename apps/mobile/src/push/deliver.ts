/**
 * Sends an answer from a notification. The app may have just woken in the background, so the
 * Host's connection is usually still opening: wait for it, briefly, then dispatch.
 */
import { Effect } from "effect";
import type { HostConnection } from "../runtime/hostConnection.ts";
import type { Answer } from "./answer.ts";

/** Within iOS's ~30 s of background time for a notification action. */
export const ANSWER_WAIT_MS = 20_000;

export type AnswerOutcome = "sent" | "no-host" | "offline" | "failed";

/** What answering needs of a HostConnection. */
export interface AnswerHost {
  readonly hostId: string;
  readonly isLive: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly retryNow: () => void;
  readonly dispatch: (payload: Answer["dispatch"]) => Promise<void>;
}

export const answerHost = (host: HostConnection): AnswerHost => ({
  hostId: host.hostId,
  isLive: () => host.live() !== null,
  subscribe: host.subscribe,
  retryNow: host.retryNow,
  dispatch: (payload) => host.run((client) => Effect.asVoid(client.dispatch(payload))),
});

/** Resolves true once `host` is live, false after `timeoutMs`. */
export const whenLive = (host: AnswerHost, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    if (host.isLive()) return resolve(true);
    host.retryNow();

    const done = (live: boolean) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(live);
    };

    const timer = setTimeout(() => done(false), timeoutMs);

    const unsubscribe = host.subscribe(() => {
      if (host.isLive()) done(true);
    });
  });

export const sendAnswer = async (
  hosts: ReadonlyArray<AnswerHost>,
  answer: Answer,
  timeoutMs = ANSWER_WAIT_MS
): Promise<AnswerOutcome> => {
  const host = hosts.find((h) => h.hostId === answer.hostId);

  if (host === undefined) return "no-host";

  if (!(await whenLive(host, timeoutMs))) return "offline";

  try {
    await host.dispatch(answer.dispatch);

    return "sent";
  } catch {
    return "failed";
  }
};

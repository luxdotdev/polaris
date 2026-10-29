/**
 * Asks the push service (apps/site's `/api/push`) to deliver a host's wake to APNs. Each
 * request is signed with the shared secret over method, path, timestamp, nonce and body
 * (README: Push). The relay passes the sealed payload on unchanged and never logs it.
 */
import {
  type LivePushRequest,
  PushHeaders,
  type PushRequest,
  signPushRequest,
  toBase64Url,
  type WakeOutcome,
  WakeOutcome as WakeOutcomeSchema,
} from "@polaris/protocol/relay";
import { Option, Schema } from "effect";

export interface PushServiceConfig {
  /** The push service's full URL, e.g. `https://polaris.lux.dev/api/push`. */
  readonly url: string;
  readonly secret: string;
}

/** Delivers a wake (`PushRequest`) or a merged Live Activity update (`LivePushRequest`). */
export type Deliver = (request: PushRequest | LivePushRequest) => Promise<WakeOutcome>;

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 10_000;

const decodeReply = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ outcome: WakeOutcomeSchema }))
);

/** The service names the outcome; a reply without one is judged by its status. */
const outcomeOf = (status: number, text: string): WakeOutcome =>
  Option.match(decodeReply(text), {
    onSome: (reply) => reply.outcome,
    onNone: () => (status === 429 ? "rate-limited" : status >= 500 ? "unavailable" : "refused"),
  });

export const pushClient = (
  config: PushServiceConfig,
  fetcher: Fetcher = fetch,
  now: () => number = Date.now
): Deliver => {
  const path = new URL(config.url).pathname;

  return async (request) => {
    const body = JSON.stringify(request);
    const timestamp = String(Math.floor(now() / 1000));
    const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
    const parts = { method: "POST", path, timestamp, nonce, body };

    try {
      const response = await fetcher(config.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [PushHeaders.timestamp]: timestamp,
          [PushHeaders.nonce]: nonce,
          [PushHeaders.signature]: await signPushRequest(config.secret, parts),
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      return outcomeOf(response.status, await response.text());
    } catch {
      return "unavailable";
    }
  };
};

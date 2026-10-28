/**
 * `POST /api/push`: the Polaris Relay asks for one notification to a device (README.md). The
 * request must carry the relay's signature, a fresh timestamp and an unused nonce; the body
 * holds the device token, its APNs environment and a payload sealed to the device.
 */
import {
  PUSH_CLOCK_SKEW_S,
  PushHeaders,
  PushRequest,
  verifyPushRequest,
  type WakeOutcome,
} from "@polaris/protocol/relay";
import { Option, Schema } from "effect";
import type { WideEvent } from "../../../../lib/log";
import type { ApnsReply, SendToApns } from "./apns";
import { APNS_HOSTS, APNS_TOPIC, type PushDeployment } from "./environment";
import type { PushStore } from "./store";
import type { ProviderTokens } from "./token";

/** A request this large is not from the relay: its body is under 4 KiB. */
export const MAX_BODY_BYTES = 8 * 1024;

/** How long APNs keeps trying a device that is off: an approval an hour old is stale. */
export const EXPIRY_S = 3600;

const NONCE_TTL_MS = 2 * PUSH_CLOCK_SKEW_S * 1000;

export interface PushDeps {
  /** `POLARIS_PUSH_SECRET`; null when unset, which refuses everything as unavailable. */
  readonly secret: string | null;
  readonly deployment: PushDeployment;
  readonly store: PushStore;
  readonly tokens: ProviderTokens;
  readonly send: SendToApns;
  readonly now?: () => number;
  /** For tests: where each APNs environment is reached. */
  readonly apnsHosts?: typeof APNS_HOSTS;
}

const STATUS: Record<WakeOutcome, number> = {
  sent: 200,
  unlinked: 403,
  "rate-limited": 429,
  unregistered: 410,
  refused: 400,
  unavailable: 503,
};

const answer = (event: WideEvent, outcome: WakeOutcome) => {
  event.push_outcome = outcome;

  return Response.json({ outcome }, { status: STATUS[outcome] });
};

const unauthorized = (event: WideEvent, rejection: string) => {
  event.rejection = rejection;

  return new Response(null, { status: 401 });
};

const decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(PushRequest));

const GONE_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);

const TOKEN_REASONS = new Set(["ExpiredProviderToken", "InvalidProviderToken"]);

/** APNs' answer as the relay's outcome (README: Outcomes). */
export const outcomeOfApns = ({ status, reason }: ApnsReply): WakeOutcome => {
  if (status === 200) return "sent";

  if (status === 410 || (reason !== null && GONE_REASONS.has(reason))) return "unregistered";

  if (status === 429) return "rate-limited";

  return status >= 500 ? "unavailable" : "refused";
};

const readBody = async (request: Request): Promise<string | null> => {
  const declared = Number(request.headers.get("content-length") ?? "0");

  if (declared > MAX_BODY_BYTES) return null;
  const text = await request.text();

  return new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES ? null : text;
};

export const createPushHandler = (deps: PushDeps) => {
  const now = deps.now ?? Date.now;
  const hosts = deps.apnsHosts ?? APNS_HOSTS;
  const { issuer } = deps.deployment;

  /** Proves the request is the relay's, fresh and not seen before; null when it is. */
  const authenticate = async (request: Request, body: string, event: WideEvent) => {
    if (deps.secret === null) return answer(event, "unavailable");
    const timestamp = request.headers.get(PushHeaders.timestamp) ?? "";
    const nonce = request.headers.get(PushHeaders.nonce) ?? "";
    const signature = request.headers.get(PushHeaders.signature) ?? "";
    const skew = Math.abs(now() / 1000 - Number(timestamp));

    if (!/^\d{1,12}$/.test(timestamp) || !(skew <= PUSH_CLOCK_SKEW_S))
      return unauthorized(event, "stale");

    if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return unauthorized(event, "bad_nonce");

    const parts = {
      method: request.method,
      path: new URL(request.url).pathname,
      timestamp,
      nonce,
      body,
    };

    if (!(await verifyPushRequest(deps.secret, parts, signature)))
      return unauthorized(event, "bad_signature");

    // Only signed requests reach the store, so it can't be filled by strangers.
    if (!(await deps.store.claim(`polaris:push:nonce:${nonce}`, NONCE_TTL_MS)))
      return unauthorized(event, "replayed");

    return null;
  };

  const deliver = async (body: PushRequest, event: WideEvent): Promise<WakeOutcome> => {
    const send = async (providerToken: string) =>
      deps.send({
        origin: hosts[body.environment],
        providerToken,
        deviceToken: body.token,
        topic: APNS_TOPIC,
        payload: body.payload,
        expiration: Math.floor(now() / 1000) + EXPIRY_S,
      });

    const first = await deps.tokens.get(issuer);
    event.token_source = first.source;
    let reply = await send(first.token);

    if (reply.status === 403 && reply.reason !== null && TOKEN_REASONS.has(reply.reason)) {
      await deps.tokens.invalidate(issuer, first.token);
      event.token_retried = true;
      reply = await send((await deps.tokens.get(issuer)).token);
    }

    event.apns_status = reply.status;
    event.apns_reason = reply.reason;

    return outcomeOfApns(reply);
  };

  return async (request: Request, event: WideEvent): Promise<Response> => {
    event.deployment_kind = deps.deployment.name;
    event.push_store = deps.store.kind;
    const body = await readBody(request);

    if (body === null) return answer(event, "refused");

    try {
      const refused = await authenticate(request, body, event);

      if (refused !== null) return refused;
      const decoded = Option.getOrNull(decodeBody(body));

      if (decoded === null) return answer(event, "refused");
      event.environment = decoded.environment;

      // Preview deployments sign with a sandbox-only key: production devices are never reached.
      if (!deps.deployment.delivers.includes(decoded.environment)) {
        event.rejection = "environment";

        return answer(event, "refused");
      }

      return answer(event, await deliver(decoded, event));
    } catch (error) {
      event.failure =
        error instanceof Error && /^[\w.-]{1,64}$/.test(error.name) ? error.name : "Error";

      return answer(event, "unavailable");
    }
  };
};

/**
 * Sends one notification to APNs over HTTP/2, keeping one session per endpoint open across
 * requests in the instance (a new connection costs ~200 ms). The body carries only a generic
 * alert and the sealed payload; the app's Notification Service Extension replaces the alert.
 */
import { type ClientHttp2Session, connect } from "node:http2";
import { Option, Schema } from "effect";

export interface ApnsRequest {
  readonly origin: string;
  readonly providerToken: string;
  readonly deviceToken: string;
  readonly topic: string;
  readonly payload: string;
  /** Unix seconds after which APNs stops trying to deliver. */
  readonly expiration: number;
}

export interface ApnsReply {
  readonly status: number;
  /** Apple's reason, e.g. `BadDeviceToken`; null on success. */
  readonly reason: string | null;
}

export type SendToApns = (request: ApnsRequest) => Promise<ApnsReply>;

/** What a phone shows if its extension can't open the payload in time. Never content. */
export const FALLBACK_ALERT = { title: "Polaris", body: "Open Polaris to see what changed." };

export const apnsBody = (payload: string): string =>
  JSON.stringify({
    aps: { alert: FALLBACK_ALERT, "mutable-content": 1, sound: "default" },
    p: payload,
  });

const decodeReason = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ reason: Schema.String }))
);

const REQUEST_TIMEOUT_MS = 8_000;

export const http2Apns = (): SendToApns => {
  const sessions = new Map<string, ClientHttp2Session>();

  const sessionFor = (origin: string) => {
    const open = sessions.get(origin);

    if (open !== undefined && !open.closed && !open.destroyed) return open;
    const session = connect(origin);

    const forget = () => {
      if (sessions.get(origin) === session) sessions.delete(origin);
    };

    session.on("error", forget);
    session.on("close", forget);
    session.on("goaway", forget);
    // An idle session must not keep the Function alive.
    session.unref();
    sessions.set(origin, session);

    return session;
  };

  return (request) =>
    new Promise((resolve, reject) => {
      const stream = sessionFor(request.origin).request({
        ":method": "POST",
        ":path": `/3/device/${request.deviceToken}`,
        authorization: `bearer ${request.providerToken}`,
        "apns-topic": request.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(request.expiration),
        "content-type": "application/json",
      });

      let status = 0;
      const chunks: Array<Buffer> = [];

      stream.setTimeout(REQUEST_TIMEOUT_MS, () => stream.close());
      stream.on("response", (headers) => (status = Number(headers[":status"])));
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("close", () => {
        if (status === 0) return reject(new Error("APNs closed the stream without a status"));
        const text = Buffer.concat(chunks).toString("utf8");

        resolve({
          status,
          reason: Option.getOrNull(Option.map(decodeReason(text), (r) => r.reason)),
        });
      });
      stream.end(apnsBody(request.payload));
    });
};

import { connect } from "node:http2";

export const APNS_SANDBOX = "https://api.sandbox.push.apple.com";

export interface ApnsResult {
  readonly status: number;
  readonly apnsId: string | null;
  readonly body: string;
  readonly ms: number;
}

/** Sends one alert push over HTTP/2 and closes the session. */
export const sendPush = (input: {
  readonly providerToken: string;
  readonly deviceToken: string;
  readonly topic: string;
  readonly host?: string;
}): Promise<ApnsResult> =>
  new Promise((resolve, reject) => {
    const started = performance.now();

    const session = connect(input.host ?? APNS_SANDBOX);

    session.on("error", reject);

    const request = session.request({
      ":method": "POST",
      ":path": `/3/device/${input.deviceToken}`,
      authorization: `bearer ${input.providerToken}`,
      "apns-topic": input.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });

    let status = 0;
    let apnsId: string | null = null;
    const chunks: Buffer[] = [];

    request.on("response", (headers) => {
      status = Number(headers[":status"]);
      apnsId = headers["apns-id"]?.toString() ?? null;
    });
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      session.close();
      resolve({
        status,
        apnsId,
        body: Buffer.concat(chunks).toString("utf8"),
        ms: performance.now() - started,
      });
    });
    request.on("error", reject);

    request.end(JSON.stringify({ aps: { alert: { title: "Polaris", body: "KMS-signed push" } } }));
  });

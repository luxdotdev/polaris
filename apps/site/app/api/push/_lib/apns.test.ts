import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type IncomingHttpHeaders, type ServerHttp2Stream } from "node:http2";
import type { AddressInfo } from "node:net";
import { apnsBody, FALLBACK_ALERT, http2Apns } from "./apns";

const received: Array<{ headers: IncomingHttpHeaders; body: string }> = [];

let sessions = 0;

const server = createServer();

server.on("session", () => sessions++);

server.on("stream", (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => {
  let body = "";
  stream.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
  stream.on("end", () => {
    received.push({ headers, body });
    const gone = headers[":path"]?.endsWith("dead") === true;
    stream.respond({ ":status": gone ? 410 : 200 });
    stream.end(gone ? JSON.stringify({ reason: "Unregistered" }) : "");
  });
});

const origin = await new Promise<string>((resolve) =>
  server.listen(0, "127.0.0.1", () => {
    // SAFETY: a listening TCP server's address is an AddressInfo.
    resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  })
);

afterAll(() => server.close());

describe("http2Apns", () => {
  test("sends an alert APNs will hand to the extension, reusing one session", async () => {
    const send = http2Apns();

    const request = {
      origin,
      providerToken: "provider",
      deviceToken: "beef",
      topic: "dev.lux.polaris.mobile",
      pushType: "alert" as const,
      priority: 10 as const,
      body: apnsBody("sealed"),
      expiration: 1_800_003_600,
    };

    expect(await send(request)).toEqual({ status: 200, reason: null });
    expect(await send({ ...request, deviceToken: "dead" })).toEqual({
      status: 410,
      reason: "Unregistered",
    });
    expect(sessions).toBe(1);

    const [first] = received;
    expect(first?.headers).toMatchObject({
      ":method": "POST",
      ":path": "/3/device/beef",
      authorization: "bearer provider",
      "apns-topic": "dev.lux.polaris.mobile",
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": "1800003600",
    });
    expect(JSON.parse(first?.body ?? "")).toEqual({
      aps: { alert: FALLBACK_ALERT, "mutable-content": 1, sound: "default" },
      p: "sealed",
    });
  });
});

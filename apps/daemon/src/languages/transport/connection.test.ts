import { expect, test } from "bun:test";
import { OrderedConnection } from "./index.ts";
import { encodeFrame } from "./framing.ts";
import { memoryPort } from "./fixture.testing.ts";
import { LanguageError } from "@polaris/protocol";
import { Schema } from "effect";

test("write FIFO bounds queued bytes/messages and closes stalled writes", async () => {
  const f = memoryPort(true);

  const connection = new OrderedConnection(
    f.port,
    () => {},
    () => {}
  );

  const writes = Array.from({ length: 256 }, (_, index) =>
    connection.send({ jsonrpc: "2.0", method: "notification", params: { index } })
  );

  const rejected = await connection.send({ jsonrpc: "2.0", method: "overflow" }).then(
    () => "resolved",
    (error: LanguageError) => error.reason
  );

  expect(rejected).toBe("queue-full");
  expect(connection.stats().queued).toBe(256);
  f.release();
  await Promise.all(writes);
  expect(f.messages[0]).toHaveProperty("params.index", 0);
  expect(f.messages[255]).toHaveProperty("params.index", 255);
  expect(connection.stats().queuedBytes).toBe(0);
  await connection.close();
  expect(f.stopped()).toBe(true);
});

test("bounded requests, deadline cancellation, matching responses and unknown IDs", async () => {
  const f = memoryPort();

  const connection = new OrderedConnection(
    f.port,
    () => {},
    () => {}
  );

  const requests = Array.from({ length: 64 }, () => connection.request("hover", {}, 1000));

  const outcomes = requests.map(({ result }) =>
    result.then(
      () => "result",
      (error: LanguageError) => error.reason
    )
  );

  expect(() => connection.request("overflow", {})).toThrow();
  f.emit(encodeFrame({ jsonrpc: "2.0", id: 999, result: "unknown" }));
  expect(connection.stats().pending).toBe(64);
  f.emit(encodeFrame({ jsonrpc: "2.0", id: requests[0]!.id, result: "first" }));
  await Bun.sleep(1);
  expect(await outcomes[0]).toBe("result");

  for (const request of requests.slice(1)) connection.cancel(request.id);
  expect((await Promise.all(outcomes)).filter((outcome) => outcome === "cancelled")).toHaveLength(
    63
  );
  const timeout = connection.request("deadline", {}, 5);

  const error = await timeout.result.then(
    () => null,
    (cause: LanguageError) => Schema.decodeUnknownSync(LanguageError)(cause)
  );

  expect(error?.reason).toBe("timeout");
  expect(connection.stats().pending).toBe(0);
  await connection.close();
});

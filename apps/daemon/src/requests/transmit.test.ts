import { expect, test } from "bun:test";
import { transmit } from "./transmit.ts";

test("an interrupted Send aborts its request instead of waiting out the deadline", async () => {
  let aborted = false;

  const server = Bun.serve({
    port: 0,
    fetch: (request) =>
      new Promise<Response>(() => {
        request.signal.addEventListener("abort", () => {
          aborted = true;
        });
      }),
  });

  try {
    const controller = new AbortController();
    const started = performance.now();

    const sent = transmit(
      { method: "GET", url: `http://127.0.0.1:${server.port}/`, headers: [] },
      { timeoutMs: 10_000, signal: controller.signal }
    );

    setTimeout(() => controller.abort(), 50);
    const result = await sent;

    await Bun.sleep(50);

    expect(result.outcome).not.toBe("ok");
    expect(performance.now() - started).toBeLessThan(2000);
    expect(aborted).toBe(true);
  } finally {
    await server.stop(true);
  }
}, 15_000);

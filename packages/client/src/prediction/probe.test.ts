import { expect, test } from "bun:test";
import { CapabilityProbe, DEFAULT_ENDPOINTS, probeEndpoint } from "./probe.ts";
import { capability } from "./fixtures.testing.ts";

const fetcher = (
  calls: string[],
  payload: Record<string, ReadonlyArray<Record<string, string | number>>> = {
    data: [{ id: "mellum2-12b-a2.5b" }],
  }
): typeof fetch =>
  Object.assign(
    async (request: string | URL | Request) => {
      calls.push(request instanceof Request ? request.url : request.toString());

      return Response.json(payload);
    },
    { preconnect: fetch.preconnect }
  );

test("Probes coalesce and expire on demand, including configured endpoint changes", async () => {
  let now = 0;
  const calls: string[] = [];

  const probe = new CapabilityProbe({
    facts: async () => capability().machine,
    fetch: fetcher(calls),
    now: () => now,
  });

  const first = probe.get();
  expect(probe.get()).toBe(first);
  const report = await first;
  expect(calls.length).toBe(3);
  expect(report.endpoints.length).toBe(2);
  now = 4999;
  expect(probe.get()).toBe(first);
  now = 5001;
  await probe.get();
  expect(calls.length).toBe(6);
  await probe.get([{ kind: "openai", url: "http://localhost:9000/v1", models: [] }]);
  expect(calls.at(-1)).toBe("http://localhost:9000/v1/models");
});

test("Native Ollama names, unreachable and malformed discovery responses are isolated", async () => {
  const calls: string[] = [];
  const endpoint = DEFAULT_ENDPOINTS[2]!;
  expect(
    await probeEndpoint(
      endpoint,
      fetcher(calls, { models: [{ name: "qwen2.5-coder-1.5b:latest" }] })
    )
  ).toEqual({ ...endpoint, models: ["qwen2.5-coder-1.5b:latest"] });
  expect(await probeEndpoint(endpoint, fetcher(calls, { models: [{ name: 123 }] }))).toBeNull();
  expect(await probeEndpoint({ ...endpoint, url: "file:///tmp/model" }, fetcher(calls))).toBeNull();

  const failed: typeof fetch = Object.assign(
    async () => {
      throw new Error("offline");
    },
    { preconnect: fetch.preconnect }
  );

  expect(await probeEndpoint(endpoint, failed)).toBeNull();
});

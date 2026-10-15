import { foldModelServers } from "./probe.ts";
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

test("model servers are folded into one entry per outermost server, Ollama's runners under Ollama", () => {
  const MiB = 1024 ** 2;

  const folded = foldModelServers([
    { pid: 1, parent: 0, rssBytes: 0, name: "launchd" },
    { pid: 10, parent: 1, rssBytes: 33 * MiB, name: "/opt/homebrew/bin/llama-server" },
    { pid: 20, parent: 1, rssBytes: 40 * MiB, name: "/Applications/Ollama.app/ollama" },
    { pid: 21, parent: 20, rssBytes: 1900 * MiB, name: "/Users/x/.ollama/runners/llama-server" },
    { pid: 22, parent: 21, rssBytes: 10 * MiB, name: "helper" },
    { pid: 30, parent: 1, rssBytes: 5 * MiB, name: "editor" },
  ]);

  expect(folded.servers).toEqual([
    { name: "ollama", rssBytes: 1950 * MiB },
    { name: "llama-server", rssBytes: 33 * MiB },
  ]);
  expect(folded.processes).toBe(2);
  expect(folded.rssBytes).toBe(1983 * MiB);
});

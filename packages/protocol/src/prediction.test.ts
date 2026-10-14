import { expect, test } from "bun:test";
import { Schema } from "effect";
import { PredictionCapabilityRequest, PredictionEndpointUrl } from "./prediction.ts";

test("capability accepts absent, empty and configured local endpoints", () => {
  const decode = Schema.decodeUnknownSync(PredictionCapabilityRequest);
  expect(decode(undefined)).toBeUndefined();
  expect(decode({ endpoints: [] })).toEqual({ endpoints: [] });
  expect(
    decode({ endpoints: ["http://127.0.0.1:8080", "https://192.168.1.2:1234"] })?.endpoints
  ).toHaveLength(2);
});

test("endpoint probes allow private literals without resolving arbitrary names", () => {
  const accepts = Schema.is(PredictionEndpointUrl);

  for (const url of [
    "http://localhost:8080",
    "http://[::1]:8080",
    "http://[fd00::1]",
    "http://10.1.2.3",
    "http://100.74.214.13:8080",
    "http://100.64.0.0",
    "http://100.127.255.255",
    "http://172.16.0.1",
  ])
    expect(accepts(url)).toBe(true);

  for (const url of [
    "file:///tmp/a",
    "http://example.com",
    "http://8.8.8.8",
    "http://100.63.255.255",
    "http://100.128.0.0",
    "http://172.32.0.1",
    "http://user:pass@localhost",
    "http://localhost?x=1",
    "http://localhost#x",
  ])
    expect(accepts(url)).toBe(false);
});

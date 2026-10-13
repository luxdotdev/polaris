import { expect, test } from "bun:test";
import { capability, input } from "./fixtures.testing.ts";
import { scorePlacement } from "./score.ts";

test("Auto ranks RAM tiers before rolling latency and the Client wins ties", () => {
  expect(scorePlacement(input())[0]?.side).toBe("client");
  const small = capability(8, "qwen2.5-coder-1.5b:latest", "AMD Ryzen");

  const ranked = scorePlacement({
    ...input(),
    client: small,
    latency: (side) => (side === "host" ? 500 : 10),
  });

  expect(ranked.map((target) => target.side)).toEqual(["host", "client"]);
  expect(ranked[1]?.format).toBe("qwen-fim");
  expect(
    scorePlacement({ ...input(), latency: (side) => (side === "host" ? 100 : 200) })[0]?.side
  ).toBe("host");
});

test("Pi-class and endpoint-less Hosts never serve, including explicit Host", () => {
  for (const host of [
    capability(4),
    capability(16, "mellum2-12b-a2.5b", "Raspberry Pi 5"),
    { ...capability(), endpoints: [] },
  ]) {
    expect(scorePlacement({ ...input(), host }).every((target) => target.side === "client")).toBe(
      true
    );
    expect(scorePlacement({ ...input(), host, override: "host" })).toEqual([]);
  }
});

test("Overrides fence placement and models must be advertised with a known format", () => {
  expect(scorePlacement({ ...input(), override: "off" })).toEqual([]);
  expect(scorePlacement({ ...input(), override: "host" }).map((target) => target.side)).toEqual([
    "host",
  ]);
  expect(
    scorePlacement({
      ...input(),
      client: capability(32, "sweep"),
      model: "sweep",
      override: "client",
    })
  ).toEqual([]);
  expect(
    scorePlacement({
      ...input(),
      client: capability(32, "custom"),
      model: "custom",
      format: "suffix",
      override: "client",
    })[0]?.format
  ).toBe("suffix");
  expect(scorePlacement({ ...input(), model: "missing" })).toEqual([]);
});

import { expect, test } from "bun:test";
import manifest from "../app.json" with { type: "json" };
import { BadHost, hostsFromArgs, withWhitelist } from "./manifest.ts";

test("whitelists https and wss for a bare host, and an origin as given", () => {
  const built = withWhitelist(
    manifest,
    hostsFromArgs([
      "--host",
      "mac.tail1.ts.net",
      "--host=ws://127.0.0.1:7477",
      "--host",
      "mac.tail1.ts.net",
    ]),
    "1.2.3"
  );

  expect(built.version).toBe("1.2.3");
  expect(built.permissions.find((p) => p.name === "network")?.whitelist).toEqual([
    "https://mac.tail1.ts.net",
    "wss://mac.tail1.ts.net",
    "ws://127.0.0.1:7477",
  ]);
  expect(built.permissions.map((p) => p.name)).toContain("g2-microphone");
});

test("refuses what isn't a host or a web origin", () => {
  expect(() => withWhitelist(manifest, ["ftp://mac"], "1.0.0")).toThrow(BadHost);
  expect(() => withWhitelist(manifest, ["https://user:pw@mac"], "1.0.0")).toThrow(BadHost);
  expect(() => withWhitelist(manifest, ["not a host"], "1.0.0")).toThrow(BadHost);
});

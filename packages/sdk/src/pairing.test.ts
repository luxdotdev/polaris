import { describe, expect, test } from "bun:test";
import { encodePairing, InvalidPairing, PAIRING_PREFIX, parsePairing } from "./pairing.ts";

const pairing = {
  hostId: "host-1",
  hostName: "Studio — 東京",
  url: "wss://studio.tail1234.ts.net/polaris/rpc",
  token: "pol_ext_abc",
  name: "Even G2",
};

const encodeJson = (json: string) =>
  PAIRING_PREFIX + Buffer.from(json, "utf8").toString("base64url");

describe("parsePairing", () => {
  test("reads what the Daemon writes, non-ASCII names and a pasted newline included", () => {
    expect(parsePairing(`  ${encodeJson(JSON.stringify(pairing))}\n`)).toEqual(pairing);
    expect(parsePairing(encodePairing({ ...pairing, url: null }))).toEqual({
      ...pairing,
      url: null,
    });
  });

  const refused: Array<[string, string, string]> = [
    ["another prefix", "polaris-pair:v2:e30", "does not start with"],
    ["not base64url", `${PAIRING_PREFIX}a+b/c`, "not base64url"],
    ["missing fields", encodeJson('{"hostId":"h"}'), "missing or malformed"],
    ["not JSON", encodeJson("hello"), "missing or malformed"],
    [
      "an http url",
      encodeJson(JSON.stringify({ ...pairing, url: "http://127.0.0.1:7477" })),
      "not ws:// or wss://",
    ],
  ];

  for (const [name, text, reason] of refused) {
    test(`refuses ${name}`, () => {
      expect(() => parsePairing(text)).toThrow(InvalidPairing);
      expect(() => parsePairing(text)).toThrow(reason);
    });
  }
});

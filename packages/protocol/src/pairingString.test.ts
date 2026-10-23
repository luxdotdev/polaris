import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { HostId } from "./ids.ts";
import { decodePairingString, encodePairingString, type PairingPayload } from "./pairingString.ts";

const payload: PairingPayload = {
  hostId: HostId.make("h_7f3a9c2e"),
  hostName: "mac-studio",
  url: "wss://mac-studio.tail4e2a.ts.net/polaris/rpc",
  token: "pol_ext_Zq8w0l3mJx9K2vB7nT4pR1sY6uE5aC0dF8gH3jL2kM9",
  name: "Phone shortcuts",
};

/** What an Extension in another language does: strip the prefix and base64url-decode the JSON. */
const jsonByHand = (text: string): string =>
  Buffer.from(text.slice("polaris-pair:v1:".length), "base64url").toString("utf8");

describe("pairing string", () => {
  test("is the v1 prefix and unpadded base64url of the payload's JSON (the contract with Extensions)", () => {
    const text = encodePairingString(payload);

    expect(text).toMatch(/^polaris-pair:v1:[A-Za-z0-9_-]+$/);
    expect(JSON.parse(jsonByHand(text))).toEqual(payload);
  });

  test("decodes what it encodes, including a null url and non-ASCII names", () => {
    const local = { ...payload, url: null, name: "Lucas’s Stream Deck ✦" };

    expect(decodePairingString(` ${encodePairingString(local)}\n`)).toEqual(Option.some(local));
  });

  test("rejects other versions, other text and payloads missing a field", () => {
    const body = encodePairingString(payload).slice("polaris-pair:v1:".length);

    const missingToken = Buffer.from(JSON.stringify({ ...payload, token: undefined })).toString(
      "base64url"
    );

    expect(decodePairingString(`polaris-pair:v2:${body}`)).toEqual(Option.none());
    expect(decodePairingString("pol_ext_Zq8w0l3mJx9K2vB7nT4pR1sY6uE5aC0dF8gH3jL2kM9")).toEqual(
      Option.none()
    );
    expect(decodePairingString(`polaris-pair:v1:${missingToken}`)).toEqual(Option.none());
    expect(decodePairingString("polaris-pair:v1:not base64!")).toEqual(Option.none());
  });
});

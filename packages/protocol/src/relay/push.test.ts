import { describe, expect, test } from "bun:test";
import { type SignedRequestParts, signPushRequest, verifyPushRequest } from "./push.ts";

const parts: SignedRequestParts = {
  method: "POST",
  path: "/api/push",
  timestamp: "1700000000",
  nonce: "bm9uY2Utbm9uY2Utbm9uY2U",
  body: '{"token":"ab","environment":"sandbox","payload":"x"}',
};

describe("push request signatures", () => {
  test("verify only under the same secret and every signed part unchanged", async () => {
    const signature = await signPushRequest("secret-a", parts);

    expect(await verifyPushRequest("secret-a", parts, signature)).toBe(true);
    expect(await verifyPushRequest("secret-b", parts, signature)).toBe(false);

    for (const changed of [
      { method: "PUT" },
      { path: "/api/other" },
      { timestamp: "1700000001" },
      { nonce: "another-nonce" },
      { body: parts.body.replace("sandbox", "production") },
    ])
      expect(await verifyPushRequest("secret-a", { ...parts, ...changed }, signature)).toBe(false);
  });

  test("a malformed signature is a failed check, not a throw", async () => {
    expect(await verifyPushRequest("secret-a", parts, "not base64url!")).toBe(false);
    expect(await verifyPushRequest("secret-a", parts, "AAAA")).toBe(false);
  });
});

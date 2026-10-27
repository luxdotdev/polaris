import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, verify } from "node:crypto";

import { signingInput, toJoseSignature } from "./jose";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

const input = signingInput({ keyId: "ABC123DEFG", teamId: "TEAM123456", issuedAt: 1 });

describe("toJoseSignature", () => {
  test("a DER signature becomes the r||s a JOSE verifier accepts", () => {
    // Many signatures, so short r or s (leading zero dropped, or a sign byte added) occur.
    for (let i = 0; i < 64; i++) {
      const der = sign("sha256", Buffer.from(input), privateKey);
      const { raw, encoding } = toJoseSignature(der);
      expect(encoding).toBe("der");
      expect(
        verify("sha256", Buffer.from(input), { key: publicKey, dsaEncoding: "ieee-p1363" }, raw)
      ).toBe(true);
    }
  });

  test("a raw signature passes through", () => {
    const raw = sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" });
    const out = toJoseSignature(raw);
    expect(out.encoding).toBe("raw");
    expect(
      verify("sha256", Buffer.from(input), { key: publicKey, dsaEncoding: "ieee-p1363" }, out.raw)
    ).toBe(true);
  });
});

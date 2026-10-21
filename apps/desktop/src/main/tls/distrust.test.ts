import { describe, expect, test } from "bun:test";
import { createECDH, createHash, createPublicKey, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PeerCertificate } from "node:tls";
import type { Certificate } from "electron";
import {
  chainIsDistrusted,
  chromiumVerdict,
  DISTRUSTED_SPKI_SHA256,
  distrustingServerIdentity,
} from "./distrust.ts";

// Test root → intermediate → localhost leaf; "weak" holds the P-384 key 4 (EM OV TLS CA - G3C's).
const pem = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures", `${name}.pem`), "utf8");

/** The SPKI hash of the P-384 key whose private scalar is `d`. */
const weakKeyHash = (d: number) => {
  const ecdh = createECDH("secp384r1");
  const scalar = Buffer.alloc(48);

  scalar[47] = d;
  ecdh.setPrivateKey(scalar);
  const point = ecdh.getPublicKey();

  const spki = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-384",
      x: point.subarray(1, 49).toString("base64url"),
      y: point.subarray(49).toString("base64url"),
    },
    format: "jwk",
  }).export({ type: "spki", format: "der" });

  return createHash("sha256").update(spki).digest("hex");
};

/** A detailed peer certificate as Node hands it over: each issuer linked, the root to itself. */
const peer = (...names: ReadonlyArray<string>): PeerCertificate => {
  interface Linked {
    raw: Buffer;
    subject: { CN: string };
    subjectaltname: string | undefined;
    issuerCertificate?: Linked;
  }

  const certs = names.map((name): Linked => ({
    raw: new X509Certificate(pem(name)).raw,
    subject: { CN: name === names[0] ? "localhost" : name },
    subjectaltname: name === names[0] ? "DNS:localhost" : undefined,
  }));

  certs.forEach((cert, i) => {
    cert.issuerCertificate = certs[i + 1] ?? cert;
  });

  // SAFETY: the fields distrustingServerIdentity and tls.checkServerIdentity read are set above.
  return certs[0] as PeerCertificate;
};

const electronCert = (...names: ReadonlyArray<string>): Certificate | undefined =>
  names.reduceRight<Certificate | undefined>(
    // SAFETY: chromiumVerdict reads only `data` and `issuerCert`.
    (issuer, name) => ({ data: pem(name), issuerCert: issuer }) as Certificate,
    undefined
  );

describe("distrusted CA keys", () => {
  test("the list is exactly the eight eMudhra G3 keys, recomputed from their private scalars", () => {
    const scalars = [156, 230, 115, 56, 155, 4, 66, 237];

    expect(new Set(scalars.map(weakKeyHash))).toEqual(new Set(DISTRUSTED_SPKI_SHA256));
  });

  test("a chain through a weak key is distrusted wherever it sits; a normal chain is not", () => {
    expect(chainIsDistrusted([pem("leaf-weak"), pem("weak"), pem("root")])).toBe(true);
    expect(chainIsDistrusted([pem("weak")])).toBe(true);
    expect(chainIsDistrusted([pem("leaf-good"), pem("good"), pem("root")])).toBe(false);
  });

  test("Node's TLS check refuses the weak chain and still checks the hostname otherwise", () => {
    expect(distrustingServerIdentity("localhost", peer("leaf-weak", "weak", "root"))?.message).toBe(
      "localhost: the certificate chain goes through a distrusted CA key"
    );
    expect(
      distrustingServerIdentity("localhost", peer("leaf-good", "good", "root"))
    ).toBeUndefined();
    expect(
      distrustingServerIdentity("example.com", peer("leaf-good", "good", "root"))
    ).toBeInstanceOf(Error);
  });

  test("Chromium's verify proc refuses the weak chain and defers to Chromium otherwise", () => {
    expect(chromiumVerdict({ certificate: electronCert("leaf-weak", "weak", "root") })).toBe(-2);
    expect(
      chromiumVerdict({
        certificate: electronCert("leaf-good"),
        validatedCertificate: electronCert("leaf-weak", "weak"),
      })
    ).toBe(-2);
    expect(chromiumVerdict({ certificate: electronCert("leaf-good", "good", "root") })).toBe(-3);
  });
});

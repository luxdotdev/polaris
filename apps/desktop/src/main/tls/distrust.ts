/**
 * Chains through a distrusted CA key are refused, whatever root vouches for them: Chromium's
 * stack (`net.fetch`, GitHub's tokens) and Node's (`node:https`), alike. See docs/adr/0074.
 */
import { createHash, X509Certificate } from "node:crypto";
import { checkServerIdentity, type PeerCertificate } from "node:tls";
import type { Certificate, Session } from "electron";

/**
 * SHA-256 of each SubjectPublicKeyInfo. The eight eMudhra G3 intermediates (October 2026) have
 * P-384 private keys of 1–255, Sectigo cross-signs included; the same list as Go 1.27.3's.
 */
export const DISTRUSTED_SPKI_SHA256: ReadonlySet<string> = new Set([
  "ebed6475c2c2d80fcb199f3fe8dd6e6b3ce60b77eb15d4e42c3dec0c6f5b5105", // EM DV TLS CA - G3B
  "49dd353dc2b919a3770645117d0e60c16115e7d1bc259eefe734b00ea434fe5f", // EM DV TLS CA - G3C
  "e0254c7fcdc265e2f0f8a428dabb75ab4ae039b4872d62f5ee57f0877d5a8a41", // EM EV TLS CA - G3B
  "5c0660a2b164910d8ff589c18e14552e9e0ec237dcefe2cb736d41a4811f81a0", // EM EV TLS CA - G3C
  "43bffa19d6ef651451f6841e019931e96f6f2eaeff28ab4b6f1ce4576de2717b", // EM OV TLS CA - G3B
  "63ecefee431d49523bc1136c4e72d0206a477086caf606cd5cf025686c109cf8", // EM OV TLS CA - G3C
  "ec4ffa1ad0ac88081314b7aaffef6a91f97cd57291bb5ba686c5415f5eb4f6b6", // EM OV CS CA - G3B
  "92c063d67e8f14db71d288e11266ffdaf69cbf115f7bab14f3bc2f68d25e0e30", // EM OV CS CA - G3C
]);

/** A certificate (DER or PEM) as the hash of its public key; null if it doesn't parse. */
export const spkiSha256 = (certificate: Buffer | string): string | null => {
  try {
    const spki = new X509Certificate(certificate).publicKey.export({ type: "spki", format: "der" });

    return createHash("sha256").update(spki).digest("hex");
  } catch {
    return null;
  }
};

/** Whether any certificate in the chain carries a distrusted key. */
export const chainIsDistrusted = (chain: Iterable<Buffer | string>): boolean => {
  for (const certificate of chain) {
    const hash = spkiSha256(certificate);

    if (hash !== null && DISTRUSTED_SPKI_SHA256.has(hash)) return true;
  }

  return false;
};

/** Each certificate up a linked chain, stopping where it repeats (a self-issued root). */
function* linked<T>(first: T | undefined, next: (cert: T) => T | undefined): Generator<T> {
  const seen = new Set<T>();

  for (let cert = first; cert !== undefined && !seen.has(cert); cert = next(cert)) {
    seen.add(cert);
    yield cert;
  }
}

const electronChain = (certificate: Certificate | undefined) =>
  [...linked(certificate, (c) => c.issuerCert)].map((c) => c.data);

/** Node's check for `node:https` / `tls.connect`: the usual hostname check, after the key check. */
export const distrustingServerIdentity = (
  hostname: string,
  cert: PeerCertificate
): Error | undefined => {
  // SAFETY: Node passes the detailed peer certificate, whose issuers hang off `issuerCertificate`.
  const detailed = cert as PeerCertificate & { issuerCertificate?: PeerCertificate };
  const chain = [...linked<typeof detailed>(detailed, (c) => c.issuerCertificate)];

  if (chainIsDistrusted(chain.map((c) => c.raw)))
    return new Error(`${hostname}: the certificate chain goes through a distrusted CA key`);

  return checkServerIdentity(hostname, cert);
};

/** Chromium's result for a request: refused (-2) through a distrusted key, else its own (-3). */
export const chromiumVerdict = (request: {
  readonly certificate?: Certificate | undefined;
  readonly validatedCertificate?: Certificate | undefined;
}): -2 | -3 =>
  chainIsDistrusted([
    ...electronChain(request.certificate),
    ...electronChain(request.validatedCertificate),
  ])
    ? -2
    : -3;

/** Installs the check on a session's TLS (call after `app.whenReady`). */
export const distrustInSession = (session: Session): void =>
  session.setCertificateVerifyProc((request, callback) => callback(chromiumVerdict(request)));

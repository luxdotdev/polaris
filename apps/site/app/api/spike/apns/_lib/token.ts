import { signJWT, signMessage } from "@vercel/kms";

import { base64url, decodeParts, signingInput, toJoseSignature, type JwtParts } from "./jose";

export type Mode = "message" | "jwt";

/** What KMS returned, for the report: never the token or key material. */
export interface SignDetail {
  readonly kmsKeyId: string;
  readonly algorithm: string;
  readonly signatureBytes?: number;
  readonly encoding?: "raw" | "der";
  readonly produced?: JwtParts;
}

export interface SignedToken {
  readonly token: string;
  readonly mode: Mode;
  readonly signMs: number;
  readonly issuedAt: number;
  readonly detail: SignDetail;
}

export interface TokenConfig {
  readonly issuerId: string;
  readonly keyId: string;
  readonly teamId: string;
}

interface Signed {
  readonly token: string;
  readonly detail: SignDetail;
}

const viaMessage = async (config: TokenConfig, issuedAt: number): Promise<Signed> => {
  const input = signingInput({ keyId: config.keyId, teamId: config.teamId, issuedAt });

  const { signature, keyId, algorithm } = await signMessage({
    issuerId: config.issuerId,
    message: input,
  });

  const { raw, encoding } = toJoseSignature(signature);

  return {
    token: `${input}.${base64url(raw)}`,
    detail: { kmsKeyId: keyId, algorithm, signatureBytes: signature.length, encoding },
  };
};

const viaJwt = async (config: TokenConfig): Promise<Signed> => {
  const { token, keyId, algorithm } = await signJWT({
    issuerId: config.issuerId,
    claims: { iss: config.teamId },
    headers: { kid: config.keyId },
    ttl: 3600,
  });

  return { token, detail: { kmsKeyId: keyId, algorithm, produced: decodeParts(token) } };
};

export const signProviderToken = async (config: TokenConfig, mode: Mode): Promise<SignedToken> => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const started = performance.now();

  const { token, detail } =
    mode === "jwt" ? await viaJwt(config) : await viaMessage(config, issuedAt);

  return { token, mode, signMs: performance.now() - started, issuedAt, detail };
};

// APNs rejects tokens older than an hour and throttles refreshes under 20 minutes.
const MAX_AGE_S = 55 * 60;

const cache = new Map<Mode, SignedToken>();

export interface CachedToken extends SignedToken {
  readonly cached: boolean;
}

export const cachedProviderToken = async (
  config: TokenConfig,
  mode: Mode
): Promise<CachedToken> => {
  const hit = cache.get(mode);

  if (hit && Date.now() / 1000 - hit.issuedAt < MAX_AGE_S) return { ...hit, cached: true };

  const fresh = await signProviderToken(config, mode);

  cache.set(mode, fresh);

  return { ...fresh, cached: false };
};

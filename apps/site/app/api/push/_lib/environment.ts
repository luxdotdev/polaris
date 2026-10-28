/**
 * Which KMS issuer and APNs endpoints a deployment uses (README: Environments). Production
 * signs with the production key and reaches both endpoints; every other deployment signs
 * with the preview key, which Apple limits to the sandbox, and refuses production tokens.
 */
import type { PushEnvironment } from "@polaris/protocol/relay";

export const APNS_TEAM_ID = "HWD6374DUX";

export const APNS_TOPIC = "dev.lux.polaris.mobile";

export const APNS_HOSTS: Record<PushEnvironment, string> = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
};

export interface Issuer {
  /** The Vercel KMS issuer holding the imported Apple key. */
  readonly issuerId: string;
  /** Apple's key ID, which KMS also uses as the JWT `kid` (imported with `importKeyId`). */
  readonly keyId: string;
}

export interface PushDeployment {
  readonly name: "production" | "preview";
  readonly issuer: Issuer;
  /** The APNs environments this deployment delivers to. */
  readonly delivers: ReadonlyArray<PushEnvironment>;
}

export const PRODUCTION: PushDeployment = {
  name: "production",
  issuer: { issuerId: "f94308cb-b4b8-4b04-8151-5d9e92fa29cc", keyId: "5L5G3J789G" },
  delivers: ["sandbox", "production"],
};

export const PREVIEW: PushDeployment = {
  name: "preview",
  issuer: { issuerId: "8128e8cf-6ba4-49b0-a44b-2e935b6a01ad", keyId: "NU22YH4SRB" },
  delivers: ["sandbox"],
};

/** Production only on Vercel's production environment; preview, development and local get preview. */
export const pushDeployment = (vercelEnv: string | undefined): PushDeployment =>
  vercelEnv === "production" ? PRODUCTION : PREVIEW;

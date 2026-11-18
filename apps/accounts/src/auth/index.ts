import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { jwt } from "better-auth/plugins/jwt";
import { Redacted } from "effect";
import type { AccountsConfig } from "../config.ts";
import type { Database } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { githubHost, githubProvider } from "./github.ts";

/** Where Better Auth's routes live; the JWKS is `{origin}${AUTH_BASE_PATH}/jwks`. */
export const AUTH_BASE_PATH = "/api/auth";

/** How long a statement lives (ADR 0112). */
export const STATEMENT_TTL = "15m";

const DAY = 60 * 60 * 24;

export const authFor = (config: AccountsConfig, db: Database) =>
  betterAuth({
    appName: "Polaris",
    baseURL: config.origin,
    basePath: AUTH_BASE_PATH,
    secret: Redacted.value(config.secret),
    trustedOrigins: [...config.trustedOrigins],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    telemetry: { enabled: false },
    user: {
      additionalFields: {
        login: { type: "string", required: true },
        githubId: { type: "string", required: true },
        primaryEmail: { type: "string", required: true },
        commitEmail: { type: "string", required: false, input: false },
      },
    },
    // A person is their GitHub account: never join two GitHub accounts into one person by address.
    account: { accountLinking: { enabled: false } },
    socialProviders: { github: githubProvider(config.github) },
    // A person's name, login and addresses come from GitHub only; the session JWT isn't a statement.
    disabledPaths: ["/update-user", "/change-email", "/token"],
    plugins: [
      githubHost(config.github, db),
      bearer(),
      jwt({
        disableSettingJwtHeader: true,
        jwks: {
          keyPairConfig: { alg: "EdDSA", crv: "Ed25519" },
          rotationInterval: 30 * DAY,
          gracePeriod: 7 * DAY,
        },
        jwt: { issuer: config.origin, audience: config.origin, expirationTime: STATEMENT_TTL },
      }),
      deviceAuthorization({ verificationUri: "/device", expiresIn: "15m", interval: "5s" }),
    ],
  });

export type Auth = ReturnType<typeof authFor>;

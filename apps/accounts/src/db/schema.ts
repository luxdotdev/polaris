import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Better Auth's tables. Property names are the field names its Drizzle adapter reads.

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    login: text("login").notNull(),
    githubId: text("github_id").notNull(),
    primaryEmail: text("primary_email").notNull(),
    commitEmail: text("commit_email"),
  },
  (t) => [
    uniqueIndex("user_login_lower_idx").on(sql`lower(${t.login})`),
    uniqueIndex("user_github_id_idx").on(t.githubId),
  ]
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)]
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)]
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)]
);

export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  alg: text("alg"),
  crv: text("crv"),
});

export const deviceCode = pgTable("device_code", {
  id: text("id").primaryKey(),
  deviceCode: text("device_code").notNull().unique(),
  userCode: text("user_code").notNull().unique(),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  pollingInterval: integer("polling_interval"),
  clientId: text("client_id"),
  scope: text("scope"),
});

// Polaris's own tables.

/** A device's sign-in in flight: started at `/sign-in`, finished by trading its code once. */
export const signIn = pgTable("sign_in", {
  id: text("id").primaryKey(),
  browserHash: text("browser_hash").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  state: text("state").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").unique(),
  codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
});

export const invite = pgTable(
  "invite",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    inviteeId: text("invitee_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    inviteeGithubId: text("invitee_github_id").notNull(),
    shareId: text("share_id").notNull(),
    shareTitle: text("share_title").notNull(),
    shareKind: text("share_kind").notNull(),
    hostName: text("host_name").notNull(),
    hostRelayAddress: text("host_relay_address").notNull(),
    hostNoiseKey: text("host_noise_key").notNull(),
    role: text("role").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    capabilityHash: text("capability_hash").notNull().unique(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (t) => [index("invite_invitee_idx").on(t.inviteeId, t.status)]
);

export const shareDevice = pgTable(
  "share_device",
  {
    inviteId: text("invite_id")
      .notNull()
      .references(() => invite.id, { onDelete: "cascade" }),
    noiseKey: text("noise_key").notNull(),
    relayAddress: text("relay_address").notNull(),
    // The session that accepted on this device; signing it out takes the device off the Share.
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("share_device_key_idx").on(t.inviteId, t.noiseKey),
    index("share_device_session_idx").on(t.sessionId),
  ]
);

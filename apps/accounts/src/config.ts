import { Config, Effect, Redacted } from "effect";

/** What an Account Server needs to run; read from the environment by {@link readConfig}. */
export interface AccountsConfig {
  /** The public origin (`BETTER_AUTH_URL`): the statements' `iss`; Polaris Cloud's is https://auth.polaris.lux.dev. */
  readonly origin: string;
  readonly databaseUrl: Redacted.Redacted;
  readonly secret: Redacted.Redacted;
  readonly github: GitHubConfig;
  readonly port: number;
  /** Origins allowed to start a sign-in and receive its redirect (the Desktop App's loopback, say). */
  readonly trustedOrigins: ReadonlyArray<string>;
}

export interface GitHubConfig {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
  /** GitHub's web origin, where OAuth runs; GitHub Enterprise Server's in a self-hosted setup. */
  readonly webUrl: string;
  /** GitHub's REST API origin. */
  readonly apiUrl: string;
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export const readConfig = Effect.gen(function* () {
  const origin = yield* Config.String("BETTER_AUTH_URL");

  return {
    origin: new URL(origin).origin,
    databaseUrl: yield* Config.Redacted("DATABASE_URL"),
    secret: yield* Config.Redacted("BETTER_AUTH_SECRET"),
    github: {
      clientId: yield* Config.String("GITHUB_CLIENT_ID"),
      clientSecret: yield* Config.Redacted("GITHUB_CLIENT_SECRET"),
      webUrl: trimSlash(
        yield* Config.String("GITHUB_URL").pipe(Config.withDefault("https://github.com"))
      ),
      apiUrl: trimSlash(
        yield* Config.String("GITHUB_API_URL").pipe(Config.withDefault("https://api.github.com"))
      ),
    },
    port: yield* Config.Port("PORT").pipe(Config.withDefault(3000)),
    trustedOrigins: (yield* Config.String("TRUSTED_ORIGINS").pipe(Config.withDefault("")))
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  } satisfies AccountsConfig;
});

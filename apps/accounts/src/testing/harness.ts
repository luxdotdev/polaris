import { Redacted, Schema } from "effect";
import { MAX_WAIT_S } from "../api/longPoll.ts";
import type { AccountsConfig } from "../config.ts";
import { migrateDatabase, openDatabase } from "../db/index.ts";
import { accountServer } from "../server/index.ts";
import { type FakeGitHubUser, startFakeGitHub } from "./fakeGitHub.ts";
import { freshDatabase } from "./postgres.ts";

/** A browser's cookies for one origin; enough for Better Auth's state and session cookies. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();
  keep(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

/** Reads a response body as `schema`, failing the test if it doesn't match. */
export const readJson = async <S extends Schema.ConstraintDecoder<unknown>>(
  response: Response,
  schema: S
) => Schema.decodeUnknownPromise(schema)(await response.json());

/** A random X25519-sized key in base64url, as a device's relay key looks. */
export const randomNoiseKey = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

/** A whole Account Server on a local port, signing people in through a fake GitHub. */
export const startAccounts = async () => {
  const github = startFakeGitHub();
  const database = await freshDatabase();
  const { db, close } = openDatabase(database.url);
  await migrateDatabase(db);

  let handle: (request: Request) => Promise<Response> = async () =>
    new Response(null, { status: 503 });

  const http = Bun.serve({
    port: 0,
    idleTimeout: MAX_WAIT_S + 15,
    fetch: (request) => handle(request),
  });

  const origin = `http://127.0.0.1:${http.port}`;

  const config: AccountsConfig = {
    origin,
    databaseUrl: Redacted.make(database.url),
    secret: Redacted.make(
      Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64")
    ),
    github: {
      clientId: github.clientId,
      clientSecret: Redacted.make(github.clientSecret),
      webUrl: github.url,
      apiUrl: `${github.url}/api/v3`,
    },
    port: http.port ?? 0,
    trustedOrigins: [],
  };

  const server = accountServer(config, db);
  handle = server.fetch;

  /** Follows redirects by hand, carrying `jar`'s cookies to this server only. */
  const browse = async (start: string, jar: CookieJar) => {
    let url = start;

    for (let hop = 0; hop < 10; hop++) {
      const headers = new Headers();

      if (url.startsWith(origin)) headers.set("cookie", jar.header());

      const response = await fetch(url, { redirect: "manual", headers });

      if (url.startsWith(origin)) jar.keep(response);

      const location = response.headers.get("location");

      if (response.status < 300 || response.status >= 400 || location === null) {
        return { response, url };
      }

      url = new URL(location, url).toString();

      if (!url.startsWith(origin) && !url.startsWith(github.url)) return { response, url };
    }

    throw new Error("too many redirects");
  };

  /** Signs `user` in the way a Desktop App does; returns the session token its loopback receives. */
  const signIn = async (user: FakeGitHubUser, jar = new CookieJar()) => {
    github.signInAs(user);
    const loopback = "http://127.0.0.1:9/callback";

    const { url } = await browse(
      `${origin}/sign-in?redirect_uri=${encodeURIComponent(loopback)}&state=s1`,
      jar
    );

    const back = new URL(url);
    const token = back.searchParams.get("token");

    if (!url.startsWith(loopback) || token === null) throw new Error(`sign-in ended at ${url}`);

    return { token, state: back.searchParams.get("state"), jar };
  };

  const call = (
    method: string,
    path: string,
    options: {
      token?: string;
      capability?: string;
      body?: object;
      headers?: Record<string, string>;
    } = {}
  ) => {
    const headers = new Headers(options.headers);
    const init: RequestInit = { method, headers };

    if (options.token !== undefined) headers.set("authorization", `Bearer ${options.token}`);

    if (options.capability !== undefined) {
      headers.set("authorization", `Capability ${options.capability}`);
    }

    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(options.body);
    }

    return fetch(`${origin}${path}`, init);
  };

  return {
    origin,
    github,
    db,
    browse,
    signIn,
    call,
    stop: async () => {
      await http.stop(true);
      await server.dispose();
      await close();
      await github.stop();
      await database.drop();
    },
  };
};

export type Accounts = Awaited<ReturnType<typeof startAccounts>>;

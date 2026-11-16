import { Schema } from "effect";
import type { Auth } from "../auth/index.ts";
import type { AccountsConfig } from "../config.ts";
import type { Database } from "../db/index.ts";
import { finishPending, signInRequestOf, startPending } from "../signIn/index.ts";

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const html = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem}button{font:inherit;padding:.4rem .9rem;margin-right:.5rem}</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );

const SignInResponse = Schema.Struct({ url: Schema.String });

const decodeSignIn = Schema.decodeUnknownPromise(SignInResponse);

const NONCE_COOKIE = "polaris_sign_in";

const nonceCookie = (config: AccountsConfig, value: string, maxAge: number) =>
  `${NONCE_COOKIE}=${value}; Path=/sign-in; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${
    config.origin.startsWith("https:") ? "; Secure" : ""
  }`;

const cookieOf = (request: Request, name: string) =>
  (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];

/** Starts GitHub sign-in in the browser, returning to `callbackURL` on this server afterwards. */
const startSignIn = async (auth: Auth, request: Request, callbackURL: string) => {
  const started = await auth.api.signInSocial({
    body: { provider: "github", callbackURL, errorCallbackURL: "/sign-in/failed" },
    headers: request.headers,
    asResponse: true,
  });

  const { url } = await decodeSignIn(await started.json());
  const headers = new Headers({ location: url, "cache-control": "no-store" });

  for (const cookie of started.headers.getSetCookie()) headers.append("set-cookie", cookie);

  return new Response(null, { status: 302, headers });
};

const cantSignIn = () =>
  html("Can't sign in", "<p>Sign-in didn't finish. Start again from Polaris.</p>", 400);

/** `/sign-in`: records a pending sign-in bound to this browser, then always asks GitHub. */
const beginSignIn = async (config: AccountsConfig, auth: Auth, db: Database, request: Request) => {
  const wanted = signInRequestOf(new URL(request.url).searchParams);

  if (wanted === undefined) {
    return html("Can't sign in", "<p>This sign-in link isn't from a Polaris app.</p>", 400);
  }

  const { id, browserSecret } = await startPending(db, wanted);
  const started = await startSignIn(auth, request, "/sign-in/done");
  started.headers.append("set-cookie", nonceCookie(config, `${id}.${browserSecret}`, 600));

  return started;
};

/** `/sign-in/done`: GitHub signed this browser in; hand the device a one-use code, never a token. */
const finishSignIn = async (config: AccountsConfig, auth: Auth, db: Database, request: Request) => {
  const [id, browserSecret] = (cookieOf(request, NONCE_COOKIE) ?? "").split(".");
  const session = await auth.api.getSession({ headers: request.headers });

  if (id === undefined || browserSecret === undefined || session === null) return cantSignIn();

  const finished = await finishPending(
    db,
    { id, browserSecret },
    { userId: session.user.id, sessionCreatedAt: session.session.createdAt }
  );

  if (finished === undefined) return cantSignIn();
  const back = new URL(finished.redirectUri);
  back.searchParams.set("code", finished.code);
  back.searchParams.set("state", finished.state);

  return new Response(null, {
    status: 302,
    headers: {
      location: back.toString(),
      "cache-control": "no-store",
      "set-cookie": nonceCookie(config, "", 0),
    },
  });
};

/**
 * The browser pages: `/sign-in` signs a device in with GitHub and hands its redirect a one-use
 * authorization code (RFC 8252, PKCE); `/device` approves a device-flow code.
 */
export const pages =
  (config: AccountsConfig, auth: Auth, db: Database) => async (request: Request) => {
    switch (new URL(request.url).pathname) {
      case "/sign-in":
        return beginSignIn(config, auth, db, request);
      case "/sign-in/done":
        return finishSignIn(config, auth, db, request);
      case "/sign-in/failed":
        return html(
          "Can't sign in",
          "<p>GitHub didn't sign you in. Start again from Polaris.</p>",
          400
        );
      case "/device":
        return devicePage(config, auth, request, new URL(request.url));
      default:
        return undefined;
    }
  };

const devicePage = async (config: AccountsConfig, auth: Auth, request: Request, url: URL) => {
  const userCode = (url.searchParams.get("user_code") ?? "").trim().toUpperCase();

  if (userCode === "") {
    return html(
      "Connect a device",
      `<h1>Connect a device</h1><form method="get"><p><label>Code shown on your device <input name="user_code" autofocus autocomplete="off"></label></p><button>Continue</button></form>`
    );
  }

  const session = await auth.api.getSession({ headers: request.headers });

  if (session === null)
    return startSignIn(auth, request, `/device?user_code=${encodeURIComponent(userCode)}`);

  if (request.method === "POST") {
    if (request.headers.get("origin") !== config.origin)
      return html("Not allowed", "<p>Not allowed.</p>", 403);
    const action = new URLSearchParams(await request.text()).get("action");
    const body = { userCode };

    const result =
      action === "approve"
        ? await auth.api.deviceApprove({ body, headers: request.headers, asResponse: true })
        : await auth.api.deviceDeny({ body, headers: request.headers, asResponse: true });

    if (!result.ok)
      return html("Can't connect", "<p>That code has expired or was already used.</p>", 400);

    return html(
      action === "approve" ? "Device connected" : "Device refused",
      action === "approve"
        ? "<p>Your device is signed in. You can close this page.</p>"
        : "<p>The device wasn't signed in.</p>"
    );
  }

  const verified = await auth.api.deviceVerify({
    query: { user_code: userCode },
    headers: request.headers,
    asResponse: true,
  });

  if (!verified.ok)
    return html("Can't connect", "<p>That code has expired or was already used.</p>", 400);

  return html(
    "Connect a device",
    `<h1>Sign in a device as @${escape(session.user.login)}?</h1><p>Code <strong>${escape(userCode)}</strong>. Only continue if this code is on a device you are setting up.</p><form method="post"><button name="action" value="approve">Sign in device</button><button name="action" value="deny">Refuse</button></form>`
  );
};

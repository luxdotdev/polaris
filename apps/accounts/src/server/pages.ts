import { Schema } from "effect";
import type { Auth } from "../auth/index.ts";
import type { AccountsConfig } from "../config.ts";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Where a signed-in device may receive its session token: a loopback port, or the Mobile App's scheme. */
export const isDeviceRedirect = (raw: string | null) => {
  if (raw === null) return false;

  try {
    const url = new URL(raw);

    if (url.protocol === "polaris:") return true;

    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
};

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const html = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem}button{font:inherit;padding:.4rem .9rem;margin-right:.5rem}</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );

const SignInResponse = Schema.Struct({ url: Schema.String });

const decodeSignIn = Schema.decodeUnknownPromise(SignInResponse);

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

/**
 * The browser pages: `/sign-in` signs a device in with GitHub and hands it a session token at its
 * loopback redirect; `/device` approves a device-flow code.
 */
export const pages = (config: AccountsConfig, auth: Auth) => async (request: Request) => {
  const url = new URL(request.url);

  switch (url.pathname) {
    case "/sign-in": {
      const redirect = url.searchParams.get("redirect_uri");

      if (!isDeviceRedirect(redirect)) {
        return html("Can't sign in", "<p>This sign-in link isn't from a Polaris app.</p>", 400);
      }

      const done = new URL("/sign-in/done", config.origin);
      done.search = url.search;

      return startSignIn(auth, request, `${done.pathname}${done.search}`);
    }

    case "/sign-in/done": {
      const redirect = url.searchParams.get("redirect_uri");
      const session = await auth.api.getSession({ headers: request.headers });

      if (session === null || redirect === null || !isDeviceRedirect(redirect)) {
        return html(
          "Can't sign in",
          "<p>Sign-in didn't finish. Start again from Polaris.</p>",
          400
        );
      }

      const context = await auth.$context;
      const deviceSession = await context.internalAdapter.createSession(session.user.id);
      const back = new URL(redirect);
      back.searchParams.set("token", deviceSession.token);
      const state = url.searchParams.get("state");

      if (state !== null) back.searchParams.set("state", state);

      return new Response(null, {
        status: 302,
        headers: { location: back.toString(), "cache-control": "no-store" },
      });
    }

    case "/sign-in/failed":
      return html(
        "Can't sign in",
        "<p>GitHub didn't sign you in. Start again from Polaris.</p>",
        400
      );
    case "/device":
      return devicePage(config, auth, request, url);
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

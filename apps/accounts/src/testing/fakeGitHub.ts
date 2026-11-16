import type { GitHubEmail } from "../github/index.ts";

export interface FakeGitHubUser {
  readonly id: number;
  readonly login: string;
  readonly name: string | null;
  readonly emails: ReadonlyArray<GitHubEmail>;
}

/**
 * GitHub's OAuth and REST endpoints the Account Server calls, on a local port. Authorizing
 * consents at once as whoever {@link FakeGitHub.signInAs} named last.
 */
export interface FakeGitHub {
  readonly url: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly signInAs: (user: FakeGitHubUser) => void;
  readonly stop: () => Promise<void>;
}

type FakeBody = Readonly<Record<string, string | number | null>> | ReadonlyArray<GitHubEmail>;

const json = (body: FakeBody, status = 200) => Response.json(body, { status });

export const startFakeGitHub = (): FakeGitHub => {
  const clientId = "fake-client-id";
  const clientSecret = "fake-client-secret";
  const users = new Map<string, FakeGitHubUser>();
  const codes = new Map<string, string>();
  const tokens = new Map<string, string>();
  let next: FakeGitHubUser | undefined;

  const userFor = (request: Request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /i, "");
    const login = token === undefined ? undefined : tokens.get(token);

    return login === undefined ? undefined : users.get(login);
  };

  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);

      switch (url.pathname) {
        case "/login/oauth/authorize": {
          if (next === undefined || url.searchParams.get("client_id") !== clientId) {
            return json({ error: "no user" }, 400);
          }

          const code = crypto.randomUUID();
          codes.set(code, next.login);
          const back = new URL(url.searchParams.get("redirect_uri") ?? "");
          back.searchParams.set("code", code);
          back.searchParams.set("state", url.searchParams.get("state") ?? "");

          return Response.redirect(back.toString(), 302);
        }

        case "/login/oauth/access_token": {
          const form = new URLSearchParams(await request.text());
          const login = codes.get(form.get("code") ?? "");

          if (login === undefined || form.get("client_secret") !== clientSecret) {
            return json({ error: "bad_verification_code" });
          }

          codes.delete(form.get("code") ?? "");
          const token = `gho_${crypto.randomUUID()}`;
          tokens.set(token, login);

          return json({ access_token: token, token_type: "bearer", scope: "read:user,user:email" });
        }

        case "/api/v3/user": {
          const user = userFor(request);

          if (user === undefined) return json({ message: "Bad credentials" }, 401);

          return json({
            id: user.id,
            login: user.login,
            name: user.name,
            avatar_url: `https://avatars.example/${user.id}`,
          });
        }

        case "/api/v3/user/emails": {
          const user = userFor(request);

          if (user === undefined) return json({ message: "Bad credentials" }, 401);

          return json(user.emails);
        }

        default:
          return json({ message: "Not Found" }, 404);
      }
    },
  });

  const url = `http://127.0.0.1:${server.port}`;

  return {
    url,
    clientId,
    clientSecret,
    signInAs: (user) => {
      users.set(user.login, user);
      next = user;
    },
    stop: () => server.stop(true),
  };
};

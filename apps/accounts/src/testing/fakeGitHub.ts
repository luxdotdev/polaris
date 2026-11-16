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
  /** Changes a person's login on GitHub, as a rename does; the Account Server isn't told. */
  readonly rename: (id: number, login: string) => void;
  readonly stop: () => Promise<void>;
}

type FakeBody = Readonly<Record<string, string | number | null>> | ReadonlyArray<GitHubEmail>;

const profile = (user: FakeGitHubUser) => ({
  id: user.id,
  login: user.login,
  name: user.name,
  avatar_url: `https://avatars.example/${user.id}`,
});

const json = (body: FakeBody, status = 200) => Response.json(body, { status });

export const startFakeGitHub = (): FakeGitHub => {
  const clientId = "fake-client-id";
  const clientSecret = "fake-client-secret";
  const users = new Map<number, FakeGitHubUser>();
  const codes = new Map<string, number>();
  const tokens = new Map<string, number>();
  let next: FakeGitHubUser | undefined;

  const userFor = (request: Request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /i, "");
    const id = token === undefined ? undefined : tokens.get(token);

    return id === undefined ? undefined : users.get(id);
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
          codes.set(code, next.id);
          const back = new URL(url.searchParams.get("redirect_uri") ?? "");
          back.searchParams.set("code", code);
          back.searchParams.set("state", url.searchParams.get("state") ?? "");

          return Response.redirect(back.toString(), 302);
        }

        case "/login/oauth/access_token": {
          const form = new URLSearchParams(await request.text());
          const id = codes.get(form.get("code") ?? "");

          if (id === undefined || form.get("client_secret") !== clientSecret) {
            return json({ error: "bad_verification_code" });
          }

          codes.delete(form.get("code") ?? "");
          const token = `gho_${crypto.randomUUID()}`;
          tokens.set(token, id);

          return json({ access_token: token, token_type: "bearer", scope: "read:user,user:email" });
        }

        case "/api/v3/user": {
          const user = userFor(request);

          if (user === undefined) return json({ message: "Bad credentials" }, 401);

          return json(profile(user));
        }

        case "/api/v3/user/emails": {
          const user = userFor(request);

          if (user === undefined) return json({ message: "Bad credentials" }, 401);

          return json(user.emails);
        }

        default: {
          const login = /^\/api\/v3\/users\/([^/]+)$/.exec(url.pathname)?.[1];

          const holder = [...users.values()].find(
            (u) => u.login.toLowerCase() === decodeURIComponent(login ?? "").toLowerCase()
          );

          if (userFor(request) === undefined) return json({ message: "Bad credentials" }, 401);

          return holder === undefined ? json({ message: "Not Found" }, 404) : json(profile(holder));
        }
      }
    },
  });

  const url = `http://127.0.0.1:${server.port}`;

  return {
    url,
    clientId,
    clientSecret,
    signInAs: (user) => {
      users.set(user.id, user);
      next = user;
    },
    rename: (id, login) => {
      const user = users.get(id);

      if (user !== undefined) users.set(id, { ...user, login });
    },
    stop: () => server.stop(true),
  };
};

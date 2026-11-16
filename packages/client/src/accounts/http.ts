/** One Account Server's endpoints over `fetch` (apps/accounts/README.md, Endpoints). */
import { Effect, Option, Schema } from "effect";
import {
  AcceptedInvite,
  type AcceptingDevice,
  AccountsError,
  CreatedInvite,
  DeviceCodeBody,
  DeviceTokenBody,
  DeviceTokenError,
  ErrorBody,
  Me,
  type NewInvite,
  PendingInvite,
  Person,
  StatementBody,
  TokenBody,
} from "./contract.ts";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface Call {
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  readonly path: string;
  readonly token?: string;
  readonly body?: unknown;
}

const unreachable = (server: string, cause: unknown) =>
  new AccountsError({
    reason: "unreachable",
    message: `couldn't reach ${server}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

const decodeError = Schema.decodeUnknownOption(Schema.fromJsonString(ErrorBody));

/** A refusal, read from the error response's text (which may not be JSON at all). */
const refused = (response: Response) =>
  Effect.promise(() => response.text().catch(() => "")).pipe(
    Effect.flatMap((text) => {
      const status = response.status;
      const tag = Option.getOrUndefined(decodeError(text))?._tag;

      const fields = {
        reason: status === 401 ? ("signed-out" as const) : ("refused" as const),
        message: tag ?? `the Account Server answered ${status}`,
        status,
      };

      return Effect.fail(
        new AccountsError(tag === undefined ? fields : { ...fields, serverTag: tag })
      );
    })
  );

const requestInit = ({ method = "GET", token, body }: Call): RequestInit => {
  const headers = new Headers({ accept: "application/json" });
  const init: RequestInit = { method, headers };

  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);

  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }

  return init;
};

/** The Account Server at `server` (its origin). Every call fails only with `AccountsError`. */
export const accountServer = (fetch: Fetch, server: string) => {
  const send = (input: Call) =>
    Effect.tryPromise({
      try: () => fetch(new URL(input.path, server).toString(), requestInit(input)),
      catch: (cause) => unreachable(server, cause),
    });

  const text = (response: Response) =>
    Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => unreachable(server, cause),
    });

  const decoded = <S extends Schema.Codec<unknown, unknown>>(schema: S, body: string) =>
    Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(body).pipe(
      Effect.mapError((cause) => unreachable(server, cause))
    );

  const call = <S extends Schema.Codec<unknown, unknown>>(schema: S, input: Call) =>
    Effect.gen(function* () {
      const response = yield* send(input);

      if (!response.ok) return yield* refused(response);

      return yield* decoded(schema, yield* text(response));
    });

  const noContent = (input: Call) =>
    Effect.gen(function* () {
      const response = yield* send(input);

      if (!response.ok) return yield* refused(response);
    });

  return {
    server,
    exchangeCode: (code: string, codeVerifier: string) =>
      Effect.map(
        call(TokenBody, {
          method: "POST",
          path: "/v1/sign-in/token",
          body: { code, code_verifier: codeVerifier },
        }),
        (body) => body.token
      ),
    deviceCode: (clientId: string) =>
      call(DeviceCodeBody, {
        method: "POST",
        path: "/api/auth/device/code",
        body: { client_id: clientId },
      }),
    /** The session token, or None while the user hasn't approved yet. */
    deviceToken: (deviceCode: string, clientId: string) =>
      Effect.gen(function* () {
        const response = yield* send({
          method: "POST",
          path: "/api/auth/device/token",
          body: {
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: deviceCode,
            client_id: clientId,
          },
        });

        const body = yield* text(response);

        if (response.ok) return Option.some((yield* decoded(DeviceTokenBody, body)).access_token);

        const error = Schema.decodeUnknownOption(Schema.fromJsonString(DeviceTokenError))(body);
        const code = Option.getOrUndefined(error)?.error;

        if (code === "authorization_pending" || code === "slow_down") return Option.none<string>();

        return yield* new AccountsError({
          reason: "sign-in-failed",
          message: code ?? `the Account Server answered ${response.status}`,
          status: response.status,
        });
      }),
    me: (token: string) => call(Me, { path: "/v1/me", token }),
    setCommitEmail: (token: string, commitEmail: string) =>
      call(Me, { method: "PUT", path: "/v1/me", token, body: { commitEmail } }),
    statement: (token: string, noiseKey: string) =>
      Effect.map(
        call(StatementBody, { method: "POST", path: "/v1/statements", token, body: { noiseKey } }),
        (body) => body.jwt
      ),
    person: (token: string, login: string) =>
      call(Person, { path: `/v1/people?login=${encodeURIComponent(login)}`, token }),
    invites: (token: string) => call(Schema.Array(PendingInvite), { path: "/v1/invites", token }),
    createInvite: (token: string, invite: NewInvite) =>
      call(CreatedInvite, { method: "POST", path: "/v1/invites", token, body: invite }),
    accept: (token: string, inviteId: string, device: AcceptingDevice) =>
      call(AcceptedInvite, {
        method: "POST",
        path: `/v1/invites/${encodeURIComponent(inviteId)}/accept`,
        token,
        body: device,
      }),
    decline: (token: string, inviteId: string) =>
      noContent({
        method: "POST",
        path: `/v1/invites/${encodeURIComponent(inviteId)}/decline`,
        token,
      }),
    signOut: (token: string) =>
      noContent({ method: "POST", path: "/api/auth/sign-out", token, body: {} }),
  };
};

export type AccountServer = ReturnType<typeof accountServer>;

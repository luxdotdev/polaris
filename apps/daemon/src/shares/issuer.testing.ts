/**
 * A fake Account Server for tests (apps/accounts/README.md is the contract it follows): an
 * Ed25519 signing key behind `/api/auth/jwks`, statements, and each Invite's accepted devices
 * as a long-poll with an ETag behind a host capability. In process as a `fetch`, or over HTTP.
 */
import type { Fetch } from "./statement.ts";

const b64 = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64url");

interface Signer {
  readonly kid: string;
  readonly keys: CryptoKeyPair;
  readonly x: string;
}

const isPair = (key: CryptoKey | CryptoKeyPair): key is CryptoKeyPair => "publicKey" in key;

const makeSigner = async (kid: string): Promise<Signer> => {
  const keys: CryptoKey | CryptoKeyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );

  if (!isPair(keys)) throw new Error("expected an Ed25519 key pair");

  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));

  return { kid, keys, x: b64(raw) };
};

/** How a listed device's statement departs from an honest one. */
export interface StatementOptions {
  /** Seconds until it expires; negative for one already stale. Default 900. */
  readonly ttlS?: number;
  readonly iss?: string;
  readonly sub?: string;
  readonly noiseKey?: string;
  /** Signed by a key that is not in the JWKS. */
  readonly forged?: boolean;
  readonly name?: string;
  /** Seconds from now it becomes valid (`nbf`); absent unless given. */
  readonly nbfS?: number;
  /** Seconds from now it says it was issued (`iat`). Default 0. */
  readonly iatS?: number;
  /** The header's `alg`. Default EdDSA. */
  readonly alg?: string;
}

export interface FakeDevice {
  readonly personId: string;
  readonly relayAddress: string;
  readonly noiseKey: string;
  readonly statement?: StatementOptions | undefined;
}

interface Invite {
  readonly capability: string;
  devices: ReadonlyArray<FakeDevice>;
  version: number;
  revoked: boolean;
  readonly waiters: Set<() => void>;
}

export interface FakeIssuer {
  /** The issuer URL: `https://accounts.test` in process, the loopback origin over HTTP. */
  readonly issuer: string;
  /** The server as a `fetch`, for a Host that reaches it in process. */
  readonly fetch: Fetch;
  /** Requests for an Invite's devices so far, held ones included. */
  readonly polls: () => number;
  /** Requests for the JWKS so far. */
  readonly jwksFetches: () => number;
  readonly invite: (inviteId: string, capability: string) => void;
  /** Replaces the Invite's accepted devices and wakes the Hosts waiting on it. */
  readonly list: (inviteId: string, devices: ReadonlyArray<FakeDevice>) => void;
  readonly statement: (
    personId: string,
    noiseKey: string,
    options?: StatementOptions
  ) => Promise<string>;
  /** Whether a Host ended the Invite's capability (`DELETE`). */
  readonly revoked: (inviteId: string) => boolean;
  /** Signs with a new key from now on; the old one leaves the JWKS. */
  readonly rotate: () => Promise<void>;
  /** While true every request fails, as an unreachable server's would. */
  down: boolean;
  readonly stop: () => void;
}

export const startFakeIssuer = async (
  options: { readonly http?: boolean } = {}
): Promise<FakeIssuer> => {
  let signer = await makeSigner("k1");
  const outsider = await makeSigner("k1");
  const invites = new Map<string, Invite>();
  let polls = 0;
  let jwksFetches = 0;
  let issuer = "https://accounts.test";

  const statement = async (personId: string, noiseKey: string, given: StatementOptions = {}) => {
    const by = given.forged === true ? outsider : signer;
    const now = Math.floor(Date.now() / 1000);

    const notBefore = given.nbfS === undefined ? [] : [["nbf", now + given.nbfS] as const];

    const claims = {
      ...Object.fromEntries(notBefore),
      iss: given.iss ?? issuer,
      aud: given.iss ?? issuer,
      sub: given.sub ?? personId,
      iat: now + (given.iatS ?? 0),
      exp: now + (given.ttlS ?? 900),
      cnf: { noiseKey: given.noiseKey ?? noiseKey },
      login: "octocat",
      name: given.name ?? "The Octocat",
      avatarUrl: "https://avatars.test/octocat",
      commitEmail: "octocat@github.test",
    };

    const signed = `${b64(JSON.stringify({ alg: given.alg ?? "EdDSA", kid: by.kid }))}.${b64(JSON.stringify(claims))}`;

    const signature = await crypto.subtle.sign(
      { name: "Ed25519" },
      by.keys.privateKey,
      new TextEncoder().encode(signed)
    );

    return `${signed}.${b64(new Uint8Array(signature))}`;
  };

  /** Resolves when the Invite's list changes, `waitS` passes or the request is aborted. */
  const held = (invite: Invite, waitS: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        invite.waiters.delete(done);
        resolve();
      };

      const timer = setTimeout(done, waitS * 1000);
      invite.waiters.add(done);
      signal.addEventListener("abort", done, { once: true });
    });

  const devices = async (request: Request, invite: Invite, waitS: number) => {
    const etag = () => `"v${invite.version}"`;

    if (request.headers.get("if-none-match") === etag()) await held(invite, waitS, request.signal);

    if (request.headers.get("if-none-match") === etag())
      return new Response(null, { status: 304, headers: { etag: etag() } });

    const body = await Promise.all(
      invite.devices.map(async (device) => ({
        personId: device.personId,
        relayAddress: device.relayAddress,
        noiseKey: device.noiseKey,
        statement: await statement(device.personId, device.noiseKey, device.statement),
      }))
    );

    return Response.json(body, { headers: { etag: etag() } });
  };

  const shares = async (request: Request, url: URL) => {
    const inviteId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    const invite = invites.get(inviteId);
    const presented = request.headers.get("authorization");

    if (invite === undefined || invite.revoked || presented !== `Capability ${invite.capability}`)
      return Response.json({ error: "unauthorized" }, { status: 401 });

    if (request.method === "DELETE") {
      invite.revoked = true;

      return new Response(null, { status: 204 });
    }

    polls++;

    return devices(request, invite, Number(url.searchParams.get("wait") ?? "60"));
  };

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (api.down) return new Response("down", { status: 503 });

    if (url.pathname === "/api/auth/jwks") {
      jwksFetches++;

      return Response.json({
        keys: [{ kty: "OKP", crv: "Ed25519", alg: "EdDSA", x: signer.x, kid: signer.kid }],
      });
    }

    return url.pathname.startsWith("/v1/shares/")
      ? shares(request, url)
      : new Response(null, { status: 404 });
  };

  const server =
    options.http === true
      ? Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 120, fetch: handle })
      : null;

  if (server !== null) issuer = `http://127.0.0.1:${server.port}`;

  const api: FakeIssuer = {
    issuer,
    fetch: (input, init) => handle(new Request(input, init)),
    polls: () => polls,
    jwksFetches: () => jwksFetches,
    invite: (inviteId, capability) => {
      invites.set(inviteId, {
        capability,
        devices: [],
        version: 0,
        revoked: false,
        waiters: new Set(),
      });
    },
    list: (inviteId, listed) => {
      const invite = invites.get(inviteId);

      if (invite === undefined) throw new Error(`no Invite ${inviteId}`);
      invite.devices = listed;
      invite.version++;
      [...invite.waiters].forEach((wake) => wake());
    },
    statement,
    revoked: (inviteId) => invites.get(inviteId)?.revoked ?? false,
    rotate: async () => {
      signer = await makeSigner(`k${Date.now()}`);
    },
    down: false,
    stop: () => {
      invites.forEach((invite) => [...invite.waiters].forEach((wake) => wake()));
      void server?.stop(true);
    },
  };

  return api;
};

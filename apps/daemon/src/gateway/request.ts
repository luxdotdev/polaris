/**
 * What an HTTP request must look like before it becomes a gateway connection.
 * The token in `hello` is the real check (ADR 0078); these refusals keep
 * browsers out: a page that resolved its own name to 127.0.0.1 sends that
 * name as Host, and a page from anywhere sends its Origin.
 */
import { GATEWAY_IDENTITY_PATH, GATEWAY_PATH } from "./config.ts";

export interface Refusal {
  readonly ok: false;
  readonly status: number;
  readonly reason: string;
}

/** `rpc` is the WebSocket upgrade; `identity` proves the secret (`identity.ts`). */
export type GatewayRoute = "rpc" | "identity";

export interface Admitted {
  readonly ok: true;
  readonly route: GatewayRoute;
}

const refusal = (status: number, reason: string): Refusal => ({ ok: false, status, reason });

const routeOf = (pathname: string): GatewayRoute | null => {
  if (pathname === GATEWAY_PATH) return "rpc";

  return pathname === GATEWAY_IDENTITY_PATH ? "identity" : null;
};

/** Hosts a request may name: loopback, or a Tailscale serve name proxying to us (ADR 0076). */
const hostnameAllowed = (hostname: string) =>
  hostname === "127.0.0.1" || hostname === "localhost" || hostname.endsWith(".ts.net");

/** A Host header is `name[:port]`; anything that could smuggle a URL part is refused. */
export const hostAllowed = (host: string | null): boolean => {
  if (host === null || /[\s@/\\?#]/.test(host)) return false;

  try {
    return hostnameAllowed(new URL(`http://${host}`).hostname.toLowerCase());
  } catch {
    return false;
  }
};

/**
 * No Origin (an SDK outside a browser) or the Even app's WebView, whose origin
 * is `http://127.0.0.1:<port>` with a port that changes every launch (ENG-406).
 */
export const originAllowed = (origin: string | null): boolean => {
  if (origin === null) return true;

  try {
    const url = new URL(origin);

    return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.origin === origin;
  } catch {
    return false;
  }
};

/** The gateway binds 127.0.0.1 only; this is the belt to that brace. */
export const isLoopbackAddress = (address: string): boolean =>
  address.startsWith("127.") || address === "::1" || address.startsWith("::ffff:127.");

/**
 * Whether `request` may be served, and by which route, or why not. `peer` is
 * the connecting address when the server knows it. `X-Forwarded-*` headers are
 * not consulted: nothing here needs them.
 */
export const admitRequest = (request: Request, peer: string | null): Admitted | Refusal => {
  if (peer !== null && !isLoopbackAddress(peer))
    return refusal(403, "The gateway accepts loopback connections only");

  const route = routeOf(new URL(request.url).pathname);

  if (route === null)
    return refusal(404, `The gateway serves ${GATEWAY_PATH} and ${GATEWAY_IDENTITY_PATH} only`);

  const method = route === "identity" ? "POST" : "GET";

  if (request.method !== method) return refusal(405, `This route answers ${method} only`);

  if (!hostAllowed(request.headers.get("host")))
    return refusal(403, "The gateway answers 127.0.0.1, localhost and *.ts.net only");

  if (!originAllowed(request.headers.get("origin")))
    return refusal(403, "The gateway refuses browser origins");

  return { ok: true, route };
};

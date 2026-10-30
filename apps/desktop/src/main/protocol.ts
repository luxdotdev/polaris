/**
 * The renderer's origin. Production pages load from `app://polaris/` (a
 * privileged standard scheme: same-origin pop-outs share the renderer process,
 * and V8 caches its code), dev pages from the Vite server. Both get a strict CSP.
 */
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol, type Session } from "electron";
import { FRAME_SRC, type FrameDocuments, frameResponse, isFrameUrl } from "./frames.ts";

export const APP_ORIGIN = "app://polaris";

const PROD_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  // Radix and sonner inject <style> elements at runtime; scripts stay strict.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  FRAME_SRC,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** Vite injects styles and talks to its server over a WebSocket for hot reload. */
const devCsp = (devUrl: string) =>
  [
    "default-src 'none'",
    // The React Refresh preamble Vite injects is an inline module script (dev only).
    `script-src 'self' 'unsafe-inline' ${devUrl}`,
    `style-src 'self' 'unsafe-inline' ${devUrl}`,
    `img-src 'self' data: blob: ${devUrl}`,
    `font-src 'self' ${devUrl}`,
    `connect-src 'self' ${devUrl} ${devUrl.replace(/^http/, "ws")}`,
    "worker-src 'self' blob:",
    FRAME_SRC,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");

/** Must run before `app` is ready. */
export const registerAppScheme = () =>
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
  ]);

/** Visualization frames only: the dev server serves the renderer itself. */
export const serveFrames = (frames: FrameDocuments) =>
  protocol.handle("app", (request) => frameResponse(frames, request.url));

export const serveRenderer = (rendererDir: string, frames: FrameDocuments) => {
  const root = normalize(rendererDir + sep);

  protocol.handle("app", async (request) => {
    if (isFrameUrl(request.url)) return frameResponse(frames, request.url);

    const { host, pathname } = new URL(request.url);

    const file = normalize(
      join(root, pathname === "/" ? "index.html" : decodeURIComponent(pathname))
    );

    if (host !== "polaris" || !file.startsWith(root)) return new Response(null, { status: 404 });

    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);

    headers.set("Content-Security-Policy", PROD_CSP);

    return new Response(response.body, { status: response.status, headers });
  });
};

export const applyDevCsp = (session: Session, devUrl: string) => {
  const csp = devCsp(new URL(devUrl).origin);

  session.webRequest.onHeadersReceived((details, callback) => {
    // A frame keeps its own CSP.
    if (isFrameUrl(details.url)) return callback({});

    callback({
      responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] },
    });
  });
};

/** A Visualization frame is never trusted, though it is served from the app's origin. */
export const isTrustedUrl = (url: string, devUrl: string | null) =>
  (url.startsWith(`${APP_ORIGIN}/`) && !isFrameUrl(url)) ||
  (devUrl !== null && new URL(url).origin === new URL(devUrl).origin);

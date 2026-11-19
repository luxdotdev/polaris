/** The download's requests: a redirect is followed only to https (docs/adr/0116). */
import { Readable } from "node:stream";
import { net } from "electron";
import { isHttps } from "./release.ts";

/** Statuses a `Response` may not carry a body with. */
const BODILESS = new Set([101, 204, 205, 304]);

/**
 * `net.request`, not `net.fetch`: fetch follows every redirect and reports neither the hops
 * nor the final address, so only a request can refuse one.
 */
export const downloadFetch = (url: string, init: RequestInit): Promise<Response> =>
  new Promise((resolve, reject) => {
    if (!isHttps(url) || init.signal?.aborted === true) {
      reject(new Error("download refused"));

      return;
    }

    const request = net.request({ url, redirect: "manual", cache: "no-store" });

    new Headers(init.headers).forEach((value, name) => request.setHeader(name, value));
    init.signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.on("abort", () => reject(new Error("aborted")));
    request.on("error", reject);

    // Electron cancels the request unless the redirect is followed synchronously here.
    request.on("redirect", (_status, _method, to) => {
      if (isHttps(to)) request.followRedirect();
      else reject(new Error("redirect refused"));
    });

    request.on("response", (message) => {
      const headers = new Headers();

      for (const [name, value] of Object.entries(message.headers))
        headers.set(name, [value].flat().join(", "));

      // Electron's IncomingMessage is a Node Readable, though its typings name only the events.
      if (!(message instanceof Readable)) {
        request.abort();

        return;
      }

      // SAFETY: a Node web stream of bytes is the byte stream a Response body takes.
      const body = Readable.toWeb(message) as ReadableStream<Uint8Array>;

      resolve(
        new Response(BODILESS.has(message.statusCode) ? null : body, {
          status: message.statusCode,
          headers,
        })
      );
    });
    request.end();
  });

/**
 * Internet requests from the main process: Chromium's network stack through `net.fetch`,
 * so the system proxy (PAC, WPAD) and the OS certificate store apply (ADR 0053).
 */
import { net } from "electron";

export type InternetFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Call after `app.whenReady`. Skips Chromium's HTTP cache unless `init.cache` says otherwise. */
export const internetFetch: InternetFetch = (url, init = {}) =>
  net.fetch(url, { cache: "no-store", ...init });

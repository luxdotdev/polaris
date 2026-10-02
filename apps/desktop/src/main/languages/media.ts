import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { posix } from "node:path";
import { LanguageAccess, abortable, languageFailure } from "@polaris/client";
import * as P from "@polaris/protocol";
import { LanguagePreviewMediaView } from "../../shared/languages.ts";
import type { LanguagePreferences } from "./settings.ts";

export const publicImageAddress = (address: string): boolean => {
  if (isIP(address) !== 4) return false;
  const [a = 0, b = 0, c = 0] = address.split(".").map(Number);

  return (
    a > 0 &&
    a < 224 &&
    a !== 10 &&
    a !== 127 &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113)
  );
};

export interface ImageResponse {
  readonly status: number;
  readonly location: string | null;
  readonly body: AsyncIterable<Uint8Array>;
  readonly close: () => void;
}

export interface ImageNetwork {
  readonly resolve: (hostname: string) => Promise<ReadonlyArray<string>>;
  /** Pin the socket to this validated IP while keeping the URL hostname for TLS. */
  readonly fetch: (url: URL, address: string, signal: AbortSignal) => Promise<ImageResponse>;
}

export const imageNetwork: ImageNetwork = {
  resolve: async (hostname) =>
    (await lookup(hostname, { all: true, family: 4 })).map((entry) => entry.address),
  fetch: (url, address, signal) =>
    new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          signal,
          method: "GET",
          agent: false,
          family: 4,
          headers: { Accept: "image/png,image/jpeg,image/gif,image/webp,image/avif" },
          lookup: (_hostname, options, callback) => {
            if (options.all) callback(null, [{ address, family: 4 }]);
            else callback(null, address, 4);
          },
        },
        (response) =>
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location ?? null,
            body: response,
            close: () => response.destroy(),
          })
      );

      request.on("error", reject);
      request.end();
    }),
};

export const rasterView = (
  bytes: Uint8Array,
  maxBytes: number
): typeof LanguagePreviewMediaView.Type => {
  if (bytes.length > maxBytes || bytes.length === 0) throw languageFailure("too-large");
  const data = Buffer.from(bytes);
  let mimeType: string;

  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    mimeType = "image/png";
  else if (data[0] === 255 && data[1] === 216 && data[2] === 255) mimeType = "image/jpeg";
  else if (["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii")))
    mimeType = "image/gif";
  else if (
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  )
    mimeType = "image/webp";
  else if (
    data.subarray(4, 8).toString("ascii") === "ftyp" &&
    ["avif", "avis"].includes(data.subarray(8, 12).toString("ascii"))
  )
    mimeType = "image/avif";
  else throw languageFailure("invalid-input");

  return LanguagePreviewMediaView.make({
    mimeType,
    bytes: bytes.length,
    base64: data.toString("base64"),
  });
};

const redirectedUrl = (response: ImageResponse, url: URL, count: number): URL | null => {
  if (![301, 302, 303, 307, 308].includes(response.status)) return null;

  if (response.location === null || count === 4) throw languageFailure("invalid-input");
  const next = new URL(response.location, url);

  if (url.protocol === "https:" && next.protocol !== "https:") throw languageFailure("not-owner");

  return next;
};

const imageBytes = async (response: ImageResponse, maxBytes: number, signal: AbortSignal) => {
  if (response.status !== 200) throw languageFailure("server-failed");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const iterator = response.body[Symbol.asyncIterator]();

  while (true) {
    const next = await abortable(iterator.next(), signal);

    if (next.done) break;
    size += next.value.length;

    if (size > maxBytes) throw languageFailure("too-large");
    chunks.push(next.value);
  }

  return Buffer.concat(chunks);
};

export class LanguageMedia {
  private active = 0;

  private async bounded<A>(work: () => Promise<A>): Promise<A> {
    if (this.active >= 4) throw languageFailure("queue-full");
    this.active++;

    try {
      return await work();
    } finally {
      this.active--;
    }
  }

  constructor(
    private readonly preferences: LanguagePreferences,
    private readonly network: ImageNetwork = imageNetwork
  ) {}

  relative(
    access: LanguageAccess,
    input: typeof P.ReadLanguagePreviewMedia.payloadSchema.Type,
    signal = new AbortController().signal
  ) {
    return this.bounded(() => this.readRelative(access, input, signal));
  }

  private async readRelative(
    access: LanguageAccess,
    input: typeof P.ReadLanguagePreviewMedia.payloadSchema.Type,
    signal = new AbortController().signal
  ) {
    const policy = this.preferences.policy(access.transport.hostId, input.checkout.workspaceId);
    const maxBytes = Math.min(policy.maxMediaBytes, input.maxBytes);

    const contained = (path: string) => {
      const relative = posix.relative(input.checkout.path, path);

      return relative !== ".." && !relative.startsWith("../") && !posix.isAbsolute(relative);
    };

    if (
      posix.isAbsolute(input.relativePath) ||
      input.relativePath.includes("\\") ||
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(input.relativePath) ||
      !contained(input.documentPath) ||
      !contained(posix.resolve(posix.dirname(input.documentPath), input.relativePath))
    )
      throw languageFailure("invalid-input");
    const joined = AbortSignal.any([signal, access.transport.signal, AbortSignal.timeout(15000)]);
    const media = await access.request("languages.preview.media", { ...input, maxBytes }, joined);

    if (media.bytes > maxBytes) throw languageFailure("too-large");

    const bytes = await abortable(
      access.transport.takeBlob(media.blobId, maxBytes, joined),
      joined
    );

    const view = rasterView(bytes, maxBytes);

    if (view.bytes !== media.bytes || view.mimeType !== media.mimeType)
      throw languageFailure("invalid-input");

    return view;
  }

  external(
    hostId: P.HostId,
    workspaceId: P.WorkspaceId,
    value: string,
    requestedBytes: number,
    signal: AbortSignal
  ) {
    return this.bounded(() =>
      this.readExternal(hostId, workspaceId, value, requestedBytes, signal)
    );
  }

  private async readExternal(
    hostId: P.HostId,
    workspaceId: P.WorkspaceId,
    value: string,
    requestedBytes: number,
    signal: AbortSignal
  ) {
    const policy = this.preferences.policy(hostId, workspaceId);

    if (policy.externalImages !== "allow") throw languageFailure("not-owner");
    const maxBytes = Math.min(policy.maxMediaBytes, requestedBytes);
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
    let url = new URL(value);

    for (let redirects = 0; redirects <= 4; redirects++) {
      if (!["https:", "http:"].includes(url.protocol) || url.username !== "" || url.password !== "")
        throw languageFailure("invalid-input");
      const addresses = await abortable(this.network.resolve(url.hostname), timeout);

      const address = addresses[0];

      if (address === undefined || !addresses.every(publicImageAddress))
        throw languageFailure("not-owner");
      const response = await abortable(this.network.fetch(url, address, timeout), timeout);

      try {
        const next = redirectedUrl(response, url, redirects);

        if (next !== null) {
          url = next;
          continue;
        }

        const bytes = await imageBytes(response, maxBytes, timeout);

        if (this.preferences.policy(hostId, workspaceId).externalImages !== "allow")
          throw languageFailure("not-owner");

        return rasterView(bytes, maxBytes);
      } finally {
        response.close();
      }
    }

    throw languageFailure("invalid-input");
  }
}

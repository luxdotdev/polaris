/**
 * An image file read from a Host, admitted only when Chromium's decode of it stays within the
 * preview caps (`admitRaster`), and typed as Chromium will sniff it. Every Host image goes here.
 */
import type { IpcError } from "../../../shared/api.ts";
import { PREVIEW_IMAGE_MAX_BYTES } from "../../../shared/languages.ts";
import { admitRaster } from "../../../shared/raster/index.ts";
import { polaris } from "../bridge.ts";

export { HostImagePool, type HostImageLease, type HostImageView } from "./pool.ts";

/** Why a Host image isn't shown: no such file, over the caps, not a raster, or no Host to ask. */
export type HostImageFailure = "missing" | "not-image" | "offline" | "unreadable";

export type HostImage =
  | {
      readonly kind: "ready";
      readonly blob: Blob;
      readonly bytes: number;
      readonly decodedBytes: number;
    }
  | { readonly kind: "too-large" }
  | { readonly kind: "failed"; readonly reason: HostImageFailure };

const MISSING = /ENOENT|no such file|not found/i;

const NOT_A_FILE = /EISDIR|ENOTFILE|is a directory|not a regular file/i;

const failureOf = (error: IpcError): HostImageFailure => {
  if (error.code === "NotConnected" || error.code === "UnknownHost") return "offline";

  if (MISSING.test(error.message)) return "missing";

  return NOT_A_FILE.test(error.message) ? "not-image" : "unreadable";
};

export const readHostImage = async (hostKey: string, path: string): Promise<HostImage> => {
  // Bounded, so a file over the cap never crosses the wire; `size` is the whole file's.
  const read = await polaris().request("files.read", {
    hostKey,
    path,
    offset: 0,
    length: PREVIEW_IMAGE_MAX_BYTES,
  });

  if (!read.ok) return { kind: "failed", reason: failureOf(read.error) };

  if (read.value.size > PREVIEW_IMAGE_MAX_BYTES) return { kind: "too-large" };

  // Text (an SVG among it) comes back inline; only raster bytes are shown.
  if (read.value.content.kind !== "bytes") return { kind: "failed", reason: "not-image" };

  // A copy on its own ArrayBuffer, as Blob requires (IPC bytes may sit on a shared one).
  const bytes = new Uint8Array(read.value.content.bytes);
  const admission = admitRaster(bytes);

  if (admission.kind === "invalid") return { kind: "failed", reason: "not-image" };

  return admission.kind === "too-large"
    ? admission
    : {
        kind: "ready",
        blob: new Blob([bytes], { type: admission.measure.mimeType }),
        bytes: bytes.length,
        decodedBytes: admission.measure.decodedBytes,
      };
};

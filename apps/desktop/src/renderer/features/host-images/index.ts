/**
 * An image file read from a Host, admitted only when Chromium's decode of it stays within the
 * preview caps (`admitRaster`), and typed as Chromium will sniff it. Every Host image goes here.
 */
import { admitRaster } from "../../../shared/raster/index.ts";
import { polaris } from "../bridge.ts";

export type HostImage =
  | { readonly kind: "ready"; readonly blob: Blob; readonly bytes: number }
  | { readonly kind: "too-large" }
  | { readonly kind: "failed" };

export const readHostImage = async (hostKey: string, path: string): Promise<HostImage> => {
  const read = await polaris().request("files.read", { hostKey, path, offset: null, length: null });

  if (!read.ok || read.value.content.kind !== "bytes") return { kind: "failed" };

  // A copy on its own ArrayBuffer, as Blob requires (IPC bytes may sit on a shared one).
  const bytes = new Uint8Array(read.value.content.bytes);
  const admission = admitRaster(bytes);

  if (admission.kind === "invalid") return { kind: "failed" };

  return admission.kind === "too-large"
    ? admission
    : {
        kind: "ready",
        blob: new Blob([bytes], { type: admission.measure.mimeType }),
        bytes: bytes.length,
      };
};

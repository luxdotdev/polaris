/**
 * Previews of sent images, from the staged file on the session's Host: read
 * once (`files.read`), decoded and scaled off the main thread, kept as a small
 * WebP in Cache Storage so a relaunch doesn't read the Host again, and as an
 * object URL in a bounded LRU while shown. Two reads at a time at most.
 */
import { useEffect, useState } from "react";
import { polaris } from "../bridge.ts";
import { Lru, THUMB_EDGE } from "./preview.ts";
import { thumbnailOf } from "./useUploads.ts";

export interface PreviewTarget {
  readonly hostKey: string;
  readonly id: string;
  readonly hostPath: string;
  readonly mimeType: string;
}

const CACHE = "polaris-attachment-previews-v1";

/** Cache Storage keys must be http(s) URLs; this one is never fetched. */
const cacheKey = (t: PreviewTarget, edge: number) =>
  `https://previews.polaris.invalid/${encodeURIComponent(t.hostKey)}/${encodeURIComponent(t.id)}/${edge}`;

const urls = new Lru<string>(64, (url) => URL.revokeObjectURL(url));

const inFlight = new Map<string, Promise<string | null>>();

let running = 0;

const waiting: Array<() => void> = [];

/** At most two Host reads at a time, so a scroll through many images doesn't flood the link. */
const limited = async <A>(task: () => Promise<A>): Promise<A> => {
  if (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;

  try {
    return await task();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
};

/** The staged file's bytes from its Host; null when it's gone or unreadable. */
export const readStaged = async (t: PreviewTarget): Promise<Blob | null> => {
  const read = await polaris().request("files.read", {
    hostKey: t.hostKey,
    path: t.hostPath,
    offset: null,
    length: null,
  });

  if (!read.ok || read.value.content.kind !== "bytes") return null;

  // A copy on its own ArrayBuffer, as Blob requires (IPC bytes may sit on a shared one).
  return new Blob([new Uint8Array(read.value.content.bytes)], { type: t.mimeType });
};

/** Scaled to fit `edge` (never up), as WebP; the bitmap is released at once. */
const scale = async (source: Blob, edge: number): Promise<Blob> => {
  const probe = await createImageBitmap(source);
  const ratio = Math.min(1, edge / Math.max(probe.width, probe.height));
  const width = Math.max(1, Math.round(probe.width * ratio));
  const height = Math.max(1, Math.round(probe.height * ratio));

  probe.close();

  const bitmap = await createImageBitmap(source, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: "high",
  });

  const canvas = new OffscreenCanvas(width, height);

  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();

  return canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
};

const openCache = () => ("caches" in globalThis ? caches.open(CACHE).catch(() => null) : null);

const load = async (t: PreviewTarget, edge: number): Promise<string | null> => {
  const key = cacheKey(t, edge);
  const cache = await openCache();
  const hit = await cache?.match(key);

  if (hit !== undefined) return URL.createObjectURL(await hit.blob());

  const thumb = await limited(async () => {
    const source = await readStaged(t);

    return source === null ? null : scale(source, edge).catch(() => null);
  });

  if (thumb === null) return null;
  void cache?.put(key, new Response(thumb)).catch(() => undefined);

  return URL.createObjectURL(thumb);
};

/** The preview's URL once ready: from memory, Cache Storage, or the Host, in that order. */
export const previewUrl = (t: PreviewTarget, edge = THUMB_EDGE): Promise<string | null> => {
  const key = cacheKey(t, edge);
  const known = urls.get(key);

  if (known !== undefined) return Promise.resolve(known);
  const pending = inFlight.get(key);

  if (pending !== undefined) return pending;

  const started = load(t, edge)
    .catch(() => null)
    .then((url) => {
      inFlight.delete(key);

      if (url !== null) urls.set(key, url);

      return url;
    });

  inFlight.set(key, started);

  return started;
};

export type PreviewState =
  | { readonly kind: "loading"; readonly placeholder: string | null }
  | { readonly kind: "ready"; readonly url: string }
  | { readonly kind: "failed" };

/** What to show now: the preview, the composer's stand-in while loading, or nothing. */
export const previewSrc = (state: PreviewState): string | null => {
  switch (state.kind) {
    case "ready":
      return state.url;
    case "loading":
      return state.placeholder;
    case "failed":
      return null;
  }
};

/**
 * A thumbnail for a sent image. While it loads, the composer's own small
 * thumbnail stands in when this window staged it.
 */
export const usePreview = (t: PreviewTarget): PreviewState => {
  const known = urls.get(cacheKey(t, THUMB_EDGE));

  const [state, setState] = useState<PreviewState>(() =>
    known === undefined
      ? { kind: "loading", placeholder: thumbnailOf(t.id) }
      : { kind: "ready", url: known }
  );

  const { hostKey, id, hostPath, mimeType } = t;

  useEffect(() => {
    let live = true;

    void previewUrl({ hostKey, id, hostPath, mimeType }).then((url) => {
      if (live) setState(url === null ? { kind: "failed" } : { kind: "ready", url });
    });

    return () => {
      live = false;
    };
  }, [hostKey, id, hostPath, mimeType]);

  return state;
};

/**
 * An image a tool read or showed (Codex `view_image`, Claude's Read on a PNG),
 * opened from its row in a dialog like a sent attachment's, read from the
 * session's Host while open.
 */
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@polaris/ui";
import { useEffect, useState } from "react";
import { polaris } from "../../bridge.ts";
import { useEditorPlace } from "../../editor-links/index.ts";
import { imageMime } from "../model/items.ts";

const absolute = (root: string | null, path: string) =>
  root === null || path.startsWith("/") || path.startsWith("~")
    ? path
    : `${root.replace(/\/$/, "")}/${path}`;

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly url: string; readonly size: number }
  | { readonly kind: "failed" };

/** The image's bytes from the Host, as an object URL revoked on close. */
const useImage = (hostKey: string, path: string): Loaded => {
  const [state, setState] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    let url: string | null = null;

    void polaris()
      .request("files.read", { hostKey, path, offset: null, length: null })
      .then((read) => {
        if (!live) return;

        if (!read.ok || read.value.content.kind !== "bytes") {
          setState({ kind: "failed" });

          return;
        }

        const bytes = new Uint8Array(read.value.content.bytes);

        url = URL.createObjectURL(new Blob([bytes], { type: imageMime(path) ?? "" }));
        setState({ kind: "ready", url, size: bytes.byteLength });
      });

    return () => {
      live = false;

      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [hostKey, path]);

  return state;
};

const kilobytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const Body = ({ hostKey, path }: { readonly hostKey: string; readonly path: string }) => {
  const image = useImage(hostKey, path);
  const [size, setSize] = useState<string | null>(null);
  const name = path.split("/").at(-1) ?? path;

  const detail = [size, image.kind === "ready" ? kilobytes(image.size) : null]
    .filter((p) => p !== null)
    .join(" · ");

  return (
    <>
      <div className="flex h-12 items-center gap-3 pr-12 pl-4">
        <DialogTitle
          className="text-label text-text-strong min-w-0 truncate font-mono"
          title={path}
        >
          {name}
        </DialogTitle>
        <DialogDescription className="text-caption text-text-subtle tabular shrink-0">
          {detail}
        </DialogDescription>
      </div>
      <div className="border-hairline bg-surface-sunken grid min-h-40 min-w-60 place-items-center border-t p-3">
        {image.kind === "ready" ? (
          <img
            src={image.url}
            alt={name}
            className="max-h-[78vh] max-w-full object-contain"
            onLoad={(event) =>
              setSize(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)
            }
          />
        ) : (
          <span className="text-body text-text-subtle">
            {image.kind === "loading" ? "Loading the image…" : "Couldn't read this image"}
          </span>
        )}
      </div>
    </>
  );
};

export interface ImageViewerProps {
  /** As the tool named it: absolute, or relative to the session's directory. */
  readonly path: string;
  readonly onClose: () => void;
}

/** Null outside a session (no Host to read from). */
export const ImageViewer = ({ path, onClose }: ImageViewerProps) => {
  const place = useEditorPlace();

  if (place === null) return null;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        className="w-auto max-w-[min(90vw,1200px)] gap-0 p-0"
        data-testid="image-viewer"
      >
        <Body hostKey={place.hostKey} path={absolute(place.root, path)} />
      </DialogContent>
    </Dialog>
  );
};

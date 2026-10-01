/**
 * What a message carried, above its bubble: images as thumbnails in the order
 * attached, each in a box reserved from its stored size, then other files as
 * compact chips. A thumbnail opens the image larger in a dialog.
 */
import { Chip, cn, Dialog, DialogContent, DialogDescription, DialogTitle } from "@polaris/ui";
import { useEffect, useMemo, useState } from "react";
import { formatSize } from "../model.ts";
import { isPreviewable, previewBox } from "../preview.ts";
import { previewSrc, type PreviewTarget, readStaged, usePreview } from "../previews.ts";

export interface SentAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly hostPath: string;
  readonly width: number | null;
  readonly height: number | null;
}

const Thumbnail = ({
  hostKey,
  attachment,
  count,
  onOpen,
}: {
  readonly hostKey: string;
  readonly attachment: SentAttachment;
  readonly count: number;
  readonly onOpen: () => void;
}) => {
  const box = previewBox(attachment, count);
  const state = usePreview({ hostKey, ...attachment });
  const known = attachment.width !== null && attachment.height !== null;

  const src = previewSrc(state);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${attachment.name}`}
      title={attachment.name}
      data-testid="sent-image"
      data-state={state.kind}
      style={{ width: box.width, height: box.height }}
      className="rounded-row border-hairline bg-surface-sunken focus-visible:ring-starlight relative shrink-0 cursor-default overflow-hidden border focus-visible:ring-2 focus-visible:outline-none"
    >
      {src === null ? (
        <span className="text-caption text-text-subtle absolute inset-0 grid place-items-center px-2 text-center">
          {state.kind === "failed" ? "No preview" : null}
        </span>
      ) : (
        <img
          src={src}
          alt=""
          draggable={false}
          className={cn(
            "size-full transition-opacity duration-200",
            known ? "object-contain" : "object-cover",
            state.kind === "loading" && "opacity-60 blur-[2px]"
          )}
        />
      )}
    </button>
  );
};

/** The image at full size, fetched from the Host while the dialog is open. */
const useFull = (target: PreviewTarget) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let created: string | null = null;
    let live = true;

    void readStaged(target).then((blob) => {
      if (blob === null || !live) return;
      created = URL.createObjectURL(blob);
      setUrl(created);
    });

    return () => {
      live = false;
      setUrl(null);

      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [target]);

  return url;
};

const Viewer = ({
  hostKey,
  attachment,
  onClose,
}: {
  readonly hostKey: string;
  readonly attachment: SentAttachment;
  readonly onClose: () => void;
}) => {
  const target = useMemo(() => ({ hostKey, ...attachment }), [hostKey, attachment]);
  const full = useFull(target);
  const thumb = usePreview(target);
  const src = full ?? (thumb.kind === "ready" ? thumb.url : null);
  const { width, height } = attachment;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        className="w-auto max-w-[min(90vw,1200px)] gap-0 p-0"
        aria-describedby="attachment-viewer-description"
        data-testid="attachment-viewer"
      >
        <div className="flex h-12 items-center gap-3 pr-12 pl-4">
          <DialogTitle className="text-label text-text-strong min-w-0 truncate font-mono">
            {attachment.name}
          </DialogTitle>
          <DialogDescription
            id="attachment-viewer-description"
            className="text-caption text-text-subtle tabular shrink-0"
          >
            {[width === null ? null : `${width} × ${height}`, formatSize(attachment.size)]
              .filter((p) => p !== null)
              .join(" · ")}
          </DialogDescription>
        </div>
        <div className="border-hairline bg-surface-sunken grid min-h-40 min-w-60 place-items-center border-t p-3">
          {src === null ? (
            <span className="text-body text-text-subtle">Loading the image…</span>
          ) : (
            <img
              src={src}
              alt={attachment.name}
              className="max-h-[78vh] max-w-full object-contain"
              style={width === null ? undefined : { aspectRatio: `${width} / ${height}` }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export interface SentAttachmentsProps {
  readonly hostKey: string;
  readonly attachments: ReadonlyArray<SentAttachment>;
}

export const SentAttachments = ({ hostKey, attachments }: SentAttachmentsProps) => {
  const [open, setOpen] = useState<SentAttachment | null>(null);
  const images = attachments.filter(isPreviewable);
  const files = attachments.filter((a) => !isPreviewable(a));

  if (attachments.length === 0) return null;

  return (
    <div className="flex max-w-[340px] flex-col items-end gap-1.5" data-testid="sent-attachments">
      {images.length === 0 ? null : (
        <div className="flex flex-wrap justify-end gap-1.5">
          {images.map((a) => (
            <Thumbnail
              key={a.id}
              hostKey={hostKey}
              attachment={a}
              count={images.length}
              onOpen={() => setOpen(a)}
            />
          ))}
        </div>
      )}
      {files.length === 0 ? null : (
        <div className="flex flex-wrap justify-end gap-1.5">
          {files.map((a) => (
            <Chip
              key={a.id}
              variant="source"
              title={`${a.name} · ${formatSize(a.size)}`}
              data-testid="sent-file"
            >
              <span className="text-micro font-regular max-w-48 truncate font-mono">{a.name}</span>
              <span className="text-micro text-text-subtle tabular">{formatSize(a.size)}</span>
            </Chip>
          ))}
        </div>
      )}
      {open === null ? null : (
        <Viewer hostKey={hostKey} attachment={open} onClose={() => setOpen(null)} />
      )}
    </div>
  );
};

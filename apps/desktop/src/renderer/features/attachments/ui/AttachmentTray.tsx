/**
 * The composer's attachment row: a chip per staged file (a thumbnail for
 * images, the name in mono, the size), removable; then what is still on its
 * way to the Host.
 */
import { Chip, CloseIcon } from "@polaris/ui";
import type { StagedAttachment } from "../../session/state.ts";
import { formatSize, type Upload, uploadLine } from "../model.ts";
import { thumbnailOf } from "../useUploads.ts";

export interface AttachmentTrayProps {
  readonly attachments: ReadonlyArray<StagedAttachment>;
  readonly uploads: ReadonlyArray<Upload>;
  readonly onRemove: (attachment: StagedAttachment) => void;
}

const Thumb = ({ id }: { readonly id: string }) => {
  const src = thumbnailOf(id);

  return src === null ? null : (
    <img src={src} alt="" className="size-4 shrink-0 rounded-[3px] object-cover" />
  );
};

export const AttachmentTray = ({ attachments, uploads, onRemove }: AttachmentTrayProps) => {
  const line = uploadLine(uploads);

  if (attachments.length === 0 && line === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="attachments">
      {attachments.map((a) => (
        <Chip
          key={a.id}
          variant="source"
          onClick={() => onRemove(a)}
          aria-label={`Remove ${a.name}`}
          title={`${a.name} · ${formatSize(a.size)} · staged on the host`}
        >
          <Thumb id={a.id} />
          <span className="text-micro font-regular max-w-48 truncate font-mono">{a.name}</span>
          <span className="text-micro text-text-subtle tabular">{formatSize(a.size)}</span>
          <CloseIcon size={10} className="text-text-subtle" />
        </Chip>
      ))}
      {line === null ? null : (
        <span className="text-caption text-text-subtle" role="status" data-testid="uploading">
          {line}
        </span>
      )}
    </div>
  );
};

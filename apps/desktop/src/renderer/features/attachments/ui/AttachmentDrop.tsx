/**
 * Wraps the composer: files pasted or dropped on it are uploaded; while files
 * are dragged over it a quiet hint says what the drop will do, and holding ⌥
 * switches it to copying into the Workspace.
 */
import { cn } from "@polaris/ui";
import { type ClipboardEvent, type DragEvent, type ReactNode, useRef, useState } from "react";
import { type DropMode, dropMode } from "../model.ts";

export interface AttachmentDropProps {
  /** Unset when the Host can't stage attachments: drops then do nothing. */
  readonly onFiles?: ((files: ReadonlyArray<File>, mode: DropMode) => void) | undefined;
  /** Where ⌥-drop copies to, as shown ("~/code/polaris"); null when copying isn't offered. */
  readonly copyTo: string | null;
  readonly className?: string;
  readonly children: ReactNode;
}

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

const filesOf = (data: DataTransfer | null): ReadonlyArray<File> =>
  data === null ? [] : [...data.files];

export const AttachmentDrop = ({ onFiles, copyTo, className, children }: AttachmentDropProps) => {
  const [hint, setHint] = useState<DropMode | null>(null);
  // dragenter/leave fire for every child crossed; count them to know when the drag really left.
  const depth = useRef(0);
  const enabled = onFiles !== undefined;

  const over = (event: DragEvent) => {
    if (!enabled || !hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setHint(dropMode(event.altKey, copyTo !== null));
  };

  const leave = () => {
    depth.current = Math.max(0, depth.current - 1);

    if (depth.current === 0) setHint(null);
  };

  const drop = (event: DragEvent) => {
    depth.current = 0;
    setHint(null);
    const files = filesOf(event.dataTransfer);

    if (!enabled || files.length === 0) return;
    event.preventDefault();
    onFiles(files, dropMode(event.altKey, copyTo !== null));
  };

  const paste = (event: ClipboardEvent) => {
    const files = filesOf(event.clipboardData);

    if (!enabled || files.length === 0) return;
    event.preventDefault();
    onFiles(files, "attach");
  };

  return (
    <div
      className={cn("relative", className)}
      onDragEnter={(event) => {
        if (enabled && hasFiles(event)) depth.current++;
      }}
      onDragOver={over}
      onDragLeave={leave}
      onDrop={drop}
      onPaste={paste}
    >
      {children}
      {hint === null ? null : (
        <div
          aria-hidden="true"
          className="rounded-card border-text-subtle/40 bg-surface-raised/90 pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-0.5 border border-dashed"
          data-testid="drop-hint"
        >
          <span className="text-label text-text-default">
            {hint === "copy" ? `Drop to copy into ${copyTo ?? ""}` : "Drop to attach"}
          </span>
          {hint === "attach" && copyTo !== null ? (
            <span className="text-caption text-text-subtle">
              Hold ⌥ to copy into the workspace instead
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
};

/**
 * `@polaris/ui`'s Composer wired for typing: ↵ sends, ⇧↵ breaks the line, esc
 * stops a Working Turn, and pasted or dropped files become attachment chips.
 */
import { Chip, CloseIcon, Composer, type Harness } from "@polaris/ui";
import type { ClipboardEvent, DragEvent, KeyboardEvent, ReactNode } from "react";
import { filesOf } from "../attachments.ts";
import type { StagedAttachment } from "../state.ts";

export interface DraftComposerProps {
  readonly harness: Harness;
  readonly picker: ReactNode;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly placeholder: string;
  readonly canSubmit: boolean;
  readonly working?: { readonly elapsed: ReactNode; readonly onStop: () => void } | undefined;
  readonly onEscape?: (() => void) | undefined;
  readonly attachments: ReadonlyArray<StagedAttachment>;
  readonly staging: number;
  readonly onFiles?: ((files: ReadonlyArray<File>) => void) | undefined;
  readonly onRemoveAttachment: (attachment: StagedAttachment) => void;
  readonly branch?: string | undefined;
  readonly tools?: ReactNode;
  readonly prominentSend?: boolean;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly className?: string;
}

const AttachmentChips = ({
  attachments,
  staging,
  onRemove,
}: {
  readonly attachments: ReadonlyArray<StagedAttachment>;
  readonly staging: number;
  readonly onRemove: (attachment: StagedAttachment) => void;
}) =>
  attachments.length === 0 && staging === 0 ? null : (
    <div className="flex flex-wrap gap-1.5" data-testid="attachments">
      {attachments.map((a) => (
        <Chip
          key={a.id}
          variant="source"
          onClick={() => onRemove(a)}
          aria-label={`Remove ${a.name}`}
        >
          <span className="text-micro font-regular max-w-48 truncate font-mono">{a.name}</span>
          <CloseIcon size={10} className="text-text-faint" />
        </Chip>
      ))}
      {staging > 0 ? <span className="text-caption text-text-faint">Attaching…</span> : null}
    </div>
  );

export const DraftComposer = ({
  harness,
  picker,
  value,
  onChange,
  onSubmit,
  placeholder,
  canSubmit,
  working,
  onEscape,
  attachments,
  staging,
  onFiles,
  onRemoveAttachment,
  branch,
  tools,
  prominentSend = false,
  disabled = false,
  autoFocus = false,
  className,
}: DraftComposerProps) => {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      if (canSubmit) onSubmit();
    } else if (event.key === "Escape" && onEscape !== undefined) {
      event.preventDefault();
      onEscape();
    }
  };

  const take = (event: ClipboardEvent | DragEvent, data: DataTransfer | null) => {
    const files = filesOf(data);

    if (files.length === 0 || onFiles === undefined) return;
    event.preventDefault();
    onFiles(files);
  };

  return (
    <div
      className={className}
      onDragOver={(event) => {
        if (onFiles !== undefined) event.preventDefault();
      }}
      onDrop={(event) => take(event, event.dataTransfer)}
    >
      <Composer
        harness={harness}
        model=""
        picker={picker}
        working={working}
        branch={branch}
        tools={tools}
        prominentSend={prominentSend}
        sendDisabled={!canSubmit}
        onSend={onSubmit}
        attachments={
          <AttachmentChips
            attachments={attachments}
            staging={staging}
            onRemove={onRemoveAttachment}
          />
        }
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(event) => take(event, event.clipboardData)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label="Prompt"
        data-testid="composer-input"
      />
    </div>
  );
};

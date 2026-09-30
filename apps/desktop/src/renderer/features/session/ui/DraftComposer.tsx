/**
 * `@polaris/ui`'s Composer wired for typing: ↵ sends, ⇧↵ breaks the line, esc
 * stops a Working Turn, and pasted or dropped files become attachment chips.
 */
import { Composer, type Harness } from "@polaris/ui";
import type { KeyboardEvent, ReactNode } from "react";
import {
  AttachmentDrop,
  AttachmentTray,
  type DropMode,
  type Upload,
} from "../../attachments/index.ts";
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
  /** ⌘↵: queue the draft as a follow-up for after the Turn in flight. */
  readonly onQueue?: (() => void) | undefined;
  /** Above the composer: the queued follow-up, when there is one. */
  readonly notice?: ReactNode;
  readonly attachments: ReadonlyArray<StagedAttachment>;
  readonly uploads: ReadonlyArray<Upload>;
  readonly onFiles?: ((files: ReadonlyArray<File>, mode: DropMode) => void) | undefined;
  /** Where ⌥-drop copies files, as shown; null or unset turns copying off. */
  readonly copyTo?: string | null;
  readonly onRemoveAttachment: (attachment: StagedAttachment) => void;
  readonly branch?: string | undefined;
  readonly tools?: ReactNode;
  readonly prominentSend?: boolean;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly className?: string;
}

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
  onQueue,
  notice,
  attachments,
  uploads,
  onFiles,
  copyTo = null,
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

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && onQueue !== undefined) {
      event.preventDefault();
      onQueue();
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      if (canSubmit) onSubmit();
    } else if (event.key === "Escape" && onEscape !== undefined) {
      event.preventDefault();
      onEscape();
    }
  };

  return (
    <div className={className}>
      {notice}
      <AttachmentDrop onFiles={onFiles} copyTo={copyTo}>
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
            <AttachmentTray
              attachments={attachments}
              uploads={uploads}
              onRemove={onRemoveAttachment}
            />
          }
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-label="Prompt"
          data-testid="composer-input"
        />
      </AttachmentDrop>
    </div>
  );
};

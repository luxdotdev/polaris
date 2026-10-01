/**
 * `@polaris/ui`'s Composer wired for typing: ↵ sends, ⇧↵ breaks the line, esc
 * stops a Working Turn, pasted or dropped files become attachment chips, and
 * `/` lists the Harness's Skills and Slash Commands above it.
 */
import type { PolarisAction } from "@polaris/protocol";
import { Composer, type Harness } from "@polaris/ui";
import { type ReactNode, useState } from "react";
import {
  AttachmentDrop,
  AttachmentTray,
  type DropMode,
  type Upload,
} from "../../attachments/index.ts";
import {
  type CommandNotice,
  type CommandOption,
  type FrecencyTable,
  Prompt,
} from "../../composer/index.ts";
import type { StagedAttachment } from "../state.ts";

/** The `/` menu's list, and what to do for a command Polaris runs itself. */
export interface ComposerCommands {
  readonly options: ReadonlyArray<CommandOption>;
  readonly loading: boolean;
  /** Called on focus: the list is read from the Host then. */
  readonly want: () => void;
  readonly onAction: (action: PolarisAction) => void;
  /** Said instead of a list when the Host can't list them (its Daemon is too old). */
  readonly notice: CommandNotice | null;
  /** The user's frecency of picks where this composer runs, and recording a pick. */
  readonly frecency: FrecencyTable;
  readonly onPicked: (option: CommandOption) => void;
}

const NO_COMMANDS: ComposerCommands = {
  options: [],
  loading: false,
  want: () => undefined,
  onAction: () => undefined,
  notice: null,
  frecency: {},
  onPicked: () => undefined,
};

export interface DraftComposerProps {
  readonly harness: Harness;
  readonly picker: ReactNode;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly placeholder: string;
  readonly canSubmit: boolean;
  readonly working?:
    | { readonly elapsed: ReactNode; readonly onStop: () => void; readonly label?: ReactNode }
    | undefined;
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
  readonly commands?: ComposerCommands;
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
  commands = NO_COMMANDS,
}: DraftComposerProps) => {
  // The menu draws in this box, above the card (which clips what it holds).
  const [menuSlot, setMenuSlot] = useState<HTMLDivElement | null>(null);

  const submit = (queue: boolean) => {
    if (queue && onQueue !== undefined) onQueue();
    else if (canSubmit) onSubmit();
  };

  const escape = () => {
    onEscape?.();

    return onEscape !== undefined;
  };

  return (
    <div className={className}>
      {notice}
      <div className="relative">
        <div ref={setMenuSlot} className="absolute inset-x-0 bottom-full z-20" />
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
            input={
              <Prompt
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                disabled={disabled}
                autoFocus={autoFocus}
                options={commands.options}
                loading={commands.loading}
                onSubmit={submit}
                onEscape={escape}
                takesFiles={onFiles !== undefined}
                onAction={commands.onAction}
                notice={commands.notice}
                frecency={commands.frecency}
                onPicked={commands.onPicked}
                onFocus={commands.want}
                menuSlot={menuSlot}
              />
            }
          />
        </AttachmentDrop>
      </div>
    </div>
  );
};

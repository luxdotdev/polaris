/**
 * The status bar's right side for the editor (DESIGN.md, Editor: status bar;
 * Paper E1): the vim mode while vim is on, the cursor or selection, the
 * file's indentation and its language. The explorer owns the bar and its left side.
 */
import { LANGUAGE_NAMES } from "../model/language.ts";
import { modeText } from "../model/vim.ts";
import { fileKey } from "../model/drafts.ts";
import { type Cursor, useEditor } from "../runtime/store.ts";

export interface EditorStatusProps {
  readonly hostKey: string;
  readonly workspaceId: string;
}

/** "Ln 28, Col 14", or "Ln 10–19 · 10 lines selected" (Paper E2a). */
export const positionText = (cursor: Cursor): string => {
  if (cursor.selected === 0) return `Ln ${cursor.line}, Col ${cursor.column}`;

  if (cursor.lines === 1)
    return `Ln ${cursor.line}, Col ${cursor.column} · ${cursor.selected} selected`;
  const first = cursor.line - cursor.lines + 1;

  return `Ln ${Math.min(first, cursor.line)}–${Math.max(first, cursor.line)} · ${cursor.lines} lines selected`;
};

export const EditorStatus = ({ hostKey, workspaceId }: EditorStatusProps) => {
  const active = useEditor((s) =>
    s.active !== null && s.active.hostKey === hostKey && s.active.workspaceId === workspaceId
      ? s.active
      : null
  );

  const cursor = useEditor((s) => s.cursor);
  const indent = useEditor((s) => s.indent);
  const vimMode = useEditor((s) => s.vimMode);

  const language = useEditor((s) =>
    active === null ? null : (s.buffers[fileKey(hostKey, active.path)]?.language ?? null)
  );

  if (active === null) return null;

  return (
    <div
      className="text-caption text-text-subtle tabular flex items-center gap-4"
      data-testid="editor-status"
    >
      {vimMode === null ? null : (
        <span data-testid="vim-mode" className="text-text-default font-mono font-medium">
          {modeText(vimMode)}
        </span>
      )}
      {cursor === null ? null : <span>{positionText(cursor)}</span>}
      <span>{indent}</span>
      {language === null ? null : <span>{LANGUAGE_NAMES[language]}</span>}
    </div>
  );
};

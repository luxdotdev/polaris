/**
 * The status row's right side for the editor (DESIGN.md, Chrome redesign → Editor): the vim
 * mode badge while vim is on, the cursor or selection, the file's indentation, the language
 * status (Paper L1) and Completions. The explorer owns the row and its left side.
 */
import { LanguageSelector } from "./LanguagePanel.tsx";
import { LanguageStatus } from "../status/LanguageStatus.tsx";
import { LANGUAGE_NAMES } from "../model/language.ts";
import { type ModeTone, modeText, modeTone, type VimMode } from "../model/vim.ts";
import { cn, harnessHue } from "@polaris/ui";
import { agentCaretLine } from "../cm/agent.ts";
import { followingText } from "../model/agent.ts";
import { fileKey, workspaceKey } from "../model/drafts.ts";
import { type Cursor, useEditor } from "../runtime/store.ts";
import { PredictionStatus } from "../prediction/Status.tsx";

export interface EditorStatusProps {
  readonly hostKey: string;
  readonly workspaceId: string;
}

/** "Ln 28, Col 14", or "Ln 10–19 · 10 lines selected" (Paper E2a). */
export const positionText = (cursor: Cursor): string => {
  if (cursor.selected === 0) return `Ln ${cursor.line}, Col ${cursor.column}`;

  if (cursor.firstLine === cursor.lastLine)
    return `Ln ${cursor.line}, Col ${cursor.column} · ${cursor.selected} selected`;
  const lines = cursor.lastLine - cursor.firstLine + 1;

  return `Ln ${cursor.firstLine}–${cursor.lastLine} · ${lines} lines selected`;
};

const TONES: Record<ModeTone, string> = {
  normal: "bg-fill-selected text-text-strong",
  insert: "bg-starlight text-[light-dark(#ffffff,#0d1830)]",
  visual: "bg-[light-dark(#dcdee3,#d4d6dc)] text-[#17181a]",
};

/** The vim mode in its filled block (DESIGN.md, Chrome redesign → Editor): never a signal colour. */
const VimBadge = ({ mode }: { readonly mode: VimMode }) => (
  <span
    data-testid="vim-mode"
    data-tone={modeTone(mode)}
    className={cn(
      "flex h-[18px] shrink-0 items-center rounded-[4px] px-1.5 font-mono text-[11px] leading-[14px] font-medium tracking-[0.04em] whitespace-nowrap",
      TONES[modeTone(mode)]
    )}
  >
    {modeText(mode)}
  </span>
);

export const EditorStatus = ({ hostKey, workspaceId }: EditorStatusProps) => {
  const active = useEditor((s) =>
    s.active !== null && s.active.hostKey === hostKey && s.active.workspaceId === workspaceId
      ? s.active
      : null
  );

  const cursor = useEditor((s) => s.cursor);
  const indent = useEditor((s) => s.indent);
  const vimMode = useEditor((s) => s.vimMode);

  const following = useEditor((s) => {
    const edit =
      active === null
        ? undefined
        : s.agentEdits[workspaceKey(hostKey, workspaceId)]?.get(active.path);

    return edit === undefined || !s.follow ? null : harnessHue(edit.harness).name;
  });

  const language = useEditor((s) =>
    active === null ? null : (s.buffers[fileKey(hostKey, active.path)]?.language ?? null)
  );

  if (active === null) return null;

  return (
    <div
      className="text-caption text-text-subtle tabular flex shrink-0 items-center gap-4 whitespace-nowrap"
      data-testid="editor-status"
    >
      {vimMode === null ? null : <VimBadge mode={vimMode} />}
      {following !== null && active !== null ? (
        <span data-testid="following">
          {followingText(following, agentCaretLine(active.view.state))}
        </span>
      ) : cursor === null ? null : (
        <span>{positionText(cursor)}</span>
      )}
      <span>{indent}</span>
      {language === null ? null : (
        <LanguageStatus
          hostKey={hostKey}
          workspaceId={workspaceId}
          path={active.path}
          language={LANGUAGE_NAMES[language]}
          languageId={language}
          languageMode={
            <LanguageSelector hostKey={hostKey} path={active.path} language={language} />
          }
        />
      )}
      <PredictionStatus hostKey={hostKey} path={active.path} />
    </div>
  );
};

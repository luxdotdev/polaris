/**
 * Compare (the conflict banner): your text against the disk's, as one
 * unified diff in the editor's look, read-only, with unchanged runs folded.
 * `@codemirror/merge` loads with it, only when asked.
 */
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { loadLanguage } from "../cm/languages.ts";
import { editorLook } from "../cm/theme.ts";
import type { LanguageId } from "../model/language.ts";

export interface CompareProps {
  readonly mine: string;
  readonly theirs: string;
  readonly language: LanguageId;
}

/** Diff colours from the diff tokens, the `-cvd` pair following the setting through CSS. */
const diffLook = EditorView.theme({
  ".cm-changedLine": { backgroundColor: "var(--color-diff-added-bg) !important" },
  ".cm-changedText": {
    backgroundColor: "var(--color-diff-added-emphasis)",
    backgroundImage: "none !important",
  },
  ".cm-deletedChunk": { backgroundColor: "var(--color-diff-removed-bg)" },
  ".cm-deletedChunk .cm-deletedText, .cm-deletedChunk del": {
    backgroundColor: "var(--color-diff-removed-emphasis)",
    textDecoration: "none",
  },
  ".cm-changeGutter": { width: "2px", paddingLeft: "0" },
  ".cm-changedLineGutter": { backgroundColor: "var(--color-diff-added)" },
  ".cm-deletedLineGutter": { backgroundColor: "var(--color-diff-removed)" },
  ".cm-collapsedLines": {
    backgroundColor: "var(--color-surface-sunken)",
    color: "var(--color-text-subtle)",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
  },
});

export const Compare = ({ mine, theirs, language }: CompareProps) => {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = host.current;

    if (parent === null) return undefined;
    let view: EditorView | null = null;
    let live = true;

    void Promise.all([import("@codemirror/merge"), loadLanguage(language)]).then(
      ([{ unifiedMergeView }, grammar]: [typeof import("@codemirror/merge"), Extension]) => {
        if (!live) return;
        view = new EditorView({
          parent,
          state: EditorState.create({
            doc: mine,
            extensions: [
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
              lineNumbers(),
              editorLook,
              diffLook,
              grammar,
              unifiedMergeView({
                original: theirs,
                mergeControls: false,
                collapseUnchanged: { margin: 3 },
              }),
            ],
          }),
        });
      }
    );

    return () => {
      live = false;
      view?.destroy();
    };
  }, [mine, theirs, language]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="editor-compare">
      <p className="text-caption text-text-subtle shrink-0 px-5 pt-2">
        Your text against the disk: removed lines are on disk now, added lines are your edits.
      </p>
      <div ref={host} className="min-h-0 flex-1 overflow-hidden [&>.cm-editor]:h-full" />
    </div>
  );
};

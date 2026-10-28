/**
 * Type-to-focus: a character typed while nothing editable has focus goes to
 * the session's composer, as in Discord. One window listener, owned by the
 * composer that opts in; it never takes a key from a field, terminal, editor or open layer.
 */
import { useEffect, useRef } from "react";

/** What a keystroke does to the composer: type it there, only focus it, or nothing. */
export type Keystroke = "type" | "focus" | null;

/** Where a key belongs to something else: text fields, xterm, CodeMirror, Monaco, menus, dialogs. */
const OWNS_KEYS = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='combobox']",
  "[role='menu']",
  "[role='menubar']",
  "[role='dialog']",
  "[role='alertdialog']",
  ".xterm",
  ".cm-editor",
  ".monaco-editor",
].join(", ");

/** A layer open anywhere (Radix portals them to the body): a dialog, sheet, menu or select list. */
const OPEN_LAYER =
  "[role='dialog'], [role='alertdialog'], [role='menu'], [data-radix-popper-content-wrapper] [role='listbox']";

/** The key starts an IME composition or a dead-key accent: the browser must deliver it. */
const composes = (event: KeyboardEvent) =>
  event.key === "Dead" || event.key === "Process" || event.keyCode === 229;

/** One printable character; Space is left to buttons and scrollers. */
const printable = (key: string) => /^.$/su.test(key) && key !== " ";

/** What a keydown should do to the composer, given the document it happened in. */
export const keystrokeFor = (event: KeyboardEvent, doc: Document): Keystroke => {
  if (event.defaultPrevented || event.isComposing) return null;

  // ⌥ too: on macOS it types accents, but it is also a shortcut modifier here (⌥1…⌥0).
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const active = doc.activeElement;

  if (active !== null && active !== doc.body && active.closest(OWNS_KEYS) !== null) return null;

  if (doc.querySelector(OPEN_LAYER) !== null) return null;

  if (composes(event)) return "focus";

  return printable(event.key) ? "type" : null;
};

export interface TypeTarget {
  /** False while the composer is disabled or not on screen. */
  readonly ready: () => boolean;
  readonly focusEnd: (text?: string) => void;
}

/**
 * While `enabled`, sends stray typing to `target`. It listens on the window after
 * the shell's keys (installed before React renders), so a bare shortcut like K wins.
 */
export const useTypeToFocus = (target: TypeTarget, enabled: boolean) => {
  const latest = useRef(target);

  useEffect(() => {
    latest.current = target;
  });

  useEffect(() => {
    if (!enabled) return undefined;

    const onKey = (event: KeyboardEvent) => {
      const stroke = keystrokeFor(event, document);

      if (stroke === null || !latest.current.ready()) return;

      if (stroke === "focus") {
        latest.current.focusEnd();

        return;
      }

      // Typed here rather than left to the browser, so it lands exactly once.
      event.preventDefault();
      latest.current.focusEnd(event.key);
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
};

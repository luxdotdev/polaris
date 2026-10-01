/**
 * The composer's prompt: a Lexical plain-text editor with Skill and Slash
 * Command chips, and the `/` menu (portalled above the composer). Its own
 * chunk; `./Prompt.tsx` shows a still stand-in until it loads.
 */
import type { PolarisAction } from "@polaris/protocol";
import { cn } from "@polaris/ui";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createPromptEditor, type EditorHooks } from "../editor/editor.ts";
import type { TypedWord } from "../editor/state.ts";
import {
  type CommandOption,
  type Draft,
  EMPTY_DRAFT,
  insertsChip,
  matchMenu,
  type Menu,
} from "../model/commands.ts";
import { type CommandNotice, noticeOpens } from "../model/notice.ts";
import { CommandMenu } from "./CommandMenu.tsx";
import "./composer.css";

export interface PromptEditorProps {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly autoFocus: boolean;
  readonly options: ReadonlyArray<CommandOption>;
  /** The list is still being read from the Host. */
  readonly loading: boolean;
  /** ↵; `queue` is true with ⌘ or Ctrl. */
  readonly onSubmit: (queue: boolean) => void;
  /** esc outside the menu; true when it did something. */
  readonly onEscape: () => boolean;
  readonly takesFiles: boolean;
  /** A command Polaris runs itself was picked. */
  readonly onAction: (action: PolarisAction) => void;
  /** First focus: when to read the Host's commands, so the menu is ready by the first `/`. */
  readonly onFocus?: (() => void) | undefined;
  /** Where the menu draws: a box above the composer's card, which clips its own content. */
  readonly menuSlot: HTMLElement | null;
  /** Said instead of a list when the Host can't list commands; ↵ runs its action. */
  readonly notice: CommandNotice | null;
}

const optionsKey = (options: ReadonlyArray<CommandOption>) =>
  options.map((o) => `${o.sigil}${o.name}`).join("\u0000");

/** Menu state: the word typed, the row highlighted, and the word esc was pressed on. */
const useMenu = (options: ReadonlyArray<CommandOption>, draft: Draft) => {
  const [typed, setTyped] = useState<TypedWord | null>(null);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const word = typed?.word ?? null;

  const menu =
    typed === null || dismissed === word
      ? null
      : matchMenu(typed.word, typed.atHead, options, draft.tokens);

  const active = menu === null ? 0 : Math.min(index, menu.options.length - 1);

  return { typed, setTyped, menu, active, index, setIndex, dismissed, setDismissed };
};

export default function PromptEditor(props: PromptEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => ({ ...EMPTY_DRAFT, text: props.value }));

  const { typed, setTyped, menu, active, index, setIndex, dismissed, setDismissed } = useMenu(
    props.options,
    draft
  );

  const waiting = typed !== null && props.loading && props.options.length === 0;

  const notice =
    props.notice !== null &&
    typed !== null &&
    dismissed !== typed.word &&
    noticeOpens(typed.word, typed.atHead, draft.tokens)
      ? props.notice
      : null;

  const open = menu !== null;
  const latest = useRef({ props, menu, index, dismissed });
  const emitted = useRef<string | null>(null);

  useEffect(() => {
    latest.current = { props, menu, index, dismissed };
  });

  const run = (option: CommandOption | undefined) => {
    if (option === undefined) return;
    setIndex(0);

    if (insertsChip(option)) {
      handle.insertChip(option);

      return;
    }

    handle.removeTypedWord();

    if (option.action !== null) latest.current.props.onAction(option.action);
  };

  /**
   * The menu as the editor stands now. Keys read this rather than the last
   * render, so ↵ right after a keystroke still picks instead of sending.
   */
  const live = (): Menu | null => {
    const now = handle.read();
    const { props: current, dismissed: was } = latest.current;

    if (now.typed === null || now.typed.word === was) return null;

    return matchMenu(now.typed.word, now.typed.atHead, current.options, now.draft.tokens);
  };

  /** The notice as the editor stands now, for the keys (like `live`). */
  const liveNotice = (): CommandNotice | null => {
    const now = handle.read();
    const { props: current, dismissed: was } = latest.current;

    if (current.notice === null || now.typed === null || now.typed.word === was) return null;

    return noticeOpens(now.typed.word, now.typed.atHead, now.draft.tokens) ? current.notice : null;
  };

  const at = (m: Menu) => Math.min(latest.current.index, m.options.length - 1);

  const [handle] = useState(() => {
    const hooks = (): EditorHooks => ({
      options: () => latest.current.props.options,
      onDraft: (next) => {
        setDraft(next);
        emitted.current = next.text;
        latest.current.props.onChange(next.text);
      },
      onTypedWord: (word) => {
        setTyped((was) => (was?.word === word?.word && was?.atHead === word?.atHead ? was : word));
        setDismissed((was) => (was === word?.word ? was : null));
      },
      menu: {
        open: () => live() !== null || liveNotice() !== null,
        move: (by) => {
          const m = live();
          const count = m?.options.length ?? 1;

          setIndex(((m === null ? 0 : at(m)) + by + count) % count);
        },
        pick: () => {
          const m = live();

          if (m !== null) run(m.options[at(m)]);
          else liveNotice()?.action?.run();
        },
        dismiss: () => setDismissed(handle.read().typed?.word ?? null),
      },
      onSubmit: (queue) => latest.current.props.onSubmit(queue),
      onEscape: () => latest.current.props.onEscape(),
      takesFiles: () => latest.current.props.takesFiles,
    });

    return createPromptEditor(hooks, "Prompt");
  });

  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = root.current;

    if (element === null) return undefined;
    const unmount = handle.mount(element);

    if (latest.current.props.autoFocus) handle.focus();

    return unmount;
  }, [handle]);

  // The draft lives outside (per session); set the editor only when it changed elsewhere.
  useEffect(() => {
    if (props.value === emitted.current) return;
    emitted.current = props.value;
    handle.setText(props.value);
  }, [handle, props.value]);

  useEffect(() => handle.editor.setEditable(!props.disabled), [handle, props.disabled]);

  const key = optionsKey(props.options);

  // A list that arrives after text was typed can make it a chip.
  useEffect(() => {
    if (key !== "") handle.retokenize();
  }, [handle, key]);

  const menuView =
    open || waiting || notice !== null ? (
      <CommandMenu
        notice={notice}
        menu={menu}
        loading={waiting}
        active={active}
        onPick={(i) => run(latest.current.menu?.options[i])}
        onHover={setIndex}
      />
    ) : null;

  return (
    <div className={cn("relative min-w-0", props.disabled && "opacity-(--opacity-dimmed)")}>
      <div
        ref={root}
        role="textbox"
        aria-multiline="true"
        aria-placeholder={props.placeholder}
        aria-autocomplete="list"
        aria-expanded={open}
        contentEditable={!props.disabled}
        suppressContentEditableWarning
        spellCheck
        data-testid="composer-input"
        data-slot="prompt"
        onFocus={props.onFocus}
        className="text-body text-text-default composer-prompt max-h-60 min-h-(--text-body--line-height) w-full min-w-0 overflow-y-auto break-words whitespace-pre-wrap outline-none"
      />
      {draft.text === "" ? (
        <div
          aria-hidden="true"
          className="text-body text-text-faint pointer-events-none absolute inset-x-0 top-0 truncate select-none"
        >
          {props.placeholder}
        </div>
      ) : null}
      {props.menuSlot === null || menuView === null ? null : createPortal(menuView, props.menuSlot)}
    </div>
  );
}

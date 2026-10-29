/**
 * The diff tab's 32px row, where a file tab has its breadcrumbs: the path and what is
 * compared, then the change count with ⇧F7 / F7, Unified or Split, Syntax-aware, Open file.
 */
import {
  Button,
  ChevronDownIcon,
  ChevronUpIcon,
  IconButton,
  SegmentedControl,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@polaris/ui";
import { useId } from "react";
import { commandShortcut } from "../../../../../shared/keymap.ts";
import { useApp } from "../../../../shell/hooks.ts";
import { crumbs } from "../../model/paths.ts";
import type { DiffStyle } from "../model/prefs.ts";
import { type DiffTarget, sideLabels } from "../model/target.ts";

export interface DiffToolbarProps {
  readonly target: DiffTarget;
  readonly root: string;
  readonly style: DiffStyle;
  readonly syntax: boolean;
  /** Why syntax-aware can't apply to this file, if it can't. */
  readonly syntaxOff: string | null;
  /** A line about the shown diff ("Only spacing changed"), if any. */
  readonly note: string | null;
  /** The diff's changes; null while there are no rows (loading, binary, too large, same). */
  readonly changes: number | null;
  readonly at: number;
  readonly onStep: (direction: 1 | -1) => void;
  readonly onStyle: (style: DiffStyle) => void;
  readonly onSyntax: (on: boolean) => void;
  readonly onOpenFile: (() => void) | null;
}

const changesLabel = (changes: number, at: number) => {
  if (changes === 0) return "No changes";

  const total = changes === 1 ? "1 change" : `${changes} changes`;

  return at === -1 ? total : `${at + 1} of ${total}`;
};

const SyntaxSwitch = ({
  syntax,
  syntaxOff,
  onSyntax,
}: Pick<DiffToolbarProps, "syntax" | "syntaxOff" | "onSyntax">) => {
  const id = useId();

  const control = (
    <span className="flex items-center gap-1.5">
      <Switch
        id={id}
        checked={syntax && syntaxOff === null}
        disabled={syntaxOff !== null}
        onCheckedChange={onSyntax}
        data-testid="diff-syntax"
      />
      <label
        htmlFor={id}
        className={syntaxOff === null ? "cursor-default" : "opacity-(--opacity-dimmed)"}
      >
        Syntax-aware
      </label>
    </span>
  );

  return syntaxOff === null ? (
    control
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent>{syntaxOff}</TooltipContent>
    </Tooltip>
  );
};

const Stepper = ({
  changes,
  at,
  onStep,
}: {
  readonly changes: number;
  readonly at: number;
  readonly onStep: (direction: 1 | -1) => void;
}) => (
  <span className="flex shrink-0 items-center gap-0.5">
    <span className="mr-1 tabular-nums" data-testid="diff-changes">
      {changesLabel(changes, at)}
    </span>
    <IconButton
      size="sm"
      label="Previous change"
      shortcut={commandShortcut("diff.previousChange")}
      icon={<ChevronUpIcon size={16} />}
      disabled={changes === 0}
      onClick={() => onStep(-1)}
    />
    <IconButton
      size="sm"
      label="Next change"
      shortcut={commandShortcut("diff.nextChange")}
      icon={<ChevronDownIcon size={16} />}
      disabled={changes === 0}
      onClick={() => onStep(1)}
    />
  </span>
);

export const DiffToolbar = (props: DiffToolbarProps) => {
  const { target, root, style, changes, at, onStep, onStyle, onOpenFile, note } = props;

  const home = useApp(
    (s) => s.hosts.find((h) => h.key === target.hostKey)?.status.host?.homeDir ?? null
  );

  const parts = crumbs(target.path, root, home);
  const folders = parts.slice(0, -1).join(" / ");

  // Squeezed, the folders ellipsize first, then the note and sides; the file name stays.
  return (
    <div
      className="text-caption text-text-subtle flex h-8 shrink-0 items-center gap-3 pr-3 pl-5"
      data-testid="diff-toolbar"
    >
      <nav
        aria-label="Path"
        title={target.path}
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap"
      >
        {folders === "" ? null : (
          <>
            <span className="min-w-[3ch] shrink-[4] truncate">{folders}</span>
            <span aria-hidden="true">/</span>
          </>
        )}
        <span className="text-text-default shrink-0">{parts.at(-1)}</span>
        <span className="text-text-subtle min-w-0 truncate">· {sideLabels(target)}</span>
        {note === null ? null : (
          <span className="text-text-subtle min-w-0 shrink-[2] truncate">· {note}</span>
        )}
      </nav>
      {changes === null ? null : <Stepper changes={changes} at={at} onStep={onStep} />}
      <SegmentedControl<DiffStyle>
        aria-label="Unified or split"
        variant="well"
        value={style}
        onValueChange={onStyle}
        options={[
          { value: "unified", label: "Unified" },
          { value: "split", label: "Split" },
        ]}
      />
      <SyntaxSwitch {...props} />
      <Button
        size="sm"
        variant="ghost"
        disabled={onOpenFile === null}
        onClick={() => onOpenFile?.()}
      >
        Open file
      </Button>
    </div>
  );
};

/**
 * The thumbs-down Verdict (Paper R1 216-0; ENG-225's fixed reason badges): reasons, an
 * optional note ("Other" needs one), the scope, then "Save verdict". In M2 it only moves the
 * finding to Dismissed and keeps the Verdict on the Host for later learning.
 */
import type { VerdictReason, VerdictScope } from "@polaris/protocol";
import {
  Button,
  cn,
  Input,
  PixelPolarisIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  ThumbDownIcon,
} from "@polaris/ui";
import { useState } from "react";
import { REASONS, SCOPES, verdictProblem } from "../model/verdict.ts";

export interface VerdictDraft {
  readonly reasons: ReadonlyArray<VerdictReason>;
  readonly text: string;
  readonly scope: VerdictScope;
}

const Reason = ({
  label,
  on,
  dashed,
  onToggle,
}: {
  readonly label: string;
  readonly on: boolean;
  readonly dashed: boolean;
  readonly onToggle: () => void;
}) => (
  <button
    type="button"
    aria-pressed={on}
    onClick={onToggle}
    className={cn(
      "text-caption px-row-x flex h-[26px] cursor-default items-center rounded-full font-medium",
      on
        ? "bg-text-strong text-bg"
        : cn(
            "text-text-default hover:bg-fill-hover border",
            dashed ? "border-hairline border-dashed" : "border-hairline"
          )
    )}
  >
    {label}
  </button>
);

const Form = ({ onSave }: { readonly onSave: (draft: VerdictDraft) => Promise<boolean> }) => {
  const [reasons, setReasons] = useState<ReadonlyArray<VerdictReason>>([]);
  const [text, setText] = useState("");
  const [scope, setScope] = useState<VerdictScope>("repo");
  const [busy, setBusy] = useState(false);
  const problem = verdictProblem(reasons, text);

  const toggle = (reason: VerdictReason) =>
    setReasons((r) => (r.includes(reason) ? r.filter((x) => x !== reason) : [...r, reason]));

  const save = async () => {
    if (problem !== null) return;
    setBusy(true);

    if (!(await onSave({ reasons, text, scope }))) setBusy(false);
  };

  return (
    <div className="flex flex-col" data-testid="verdict-popover">
      <div className="flex flex-col gap-1 px-3.5 pt-3.5 pb-2.5">
        <span className="text-heading-sm text-text-strong font-medium">
          Why is this not a problem?
        </span>
        <span className="text-caption text-text-subtle">
          It moves to dismissed; the verdict stays with this repo’s reviews.
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 px-3.5 pb-3">
        {REASONS.map((r) => (
          <Reason
            key={r.value}
            label={r.label}
            on={reasons.includes(r.value)}
            dashed={r.value === "other"}
            onToggle={() => toggle(r.value)}
          />
        ))}
      </div>
      <div className="px-3.5 pb-3">
        <Input
          aria-label="Note"
          placeholder={reasons.includes("other") ? "Say why" : "Add a note (optional)"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5 px-3.5 pb-3.5">
        <span className="text-caption text-text-faint">Applies to</span>
        <SegmentedControl
          aria-label="Applies to"
          variant="fill"
          options={SCOPES}
          value={scope}
          onValueChange={setScope}
        />
      </div>
      <div className="border-hairline bg-surface-sunken gap-gap flex items-center border-t px-3.5 py-2">
        <PixelPolarisIcon size={16} className="text-starlight" />
        <span className="text-caption text-text-subtle flex-1">
          Polaris never changes its rules without you
        </span>
        <Button
          size="xs"
          variant="primary"
          disabled={problem !== null || busy}
          title={problem ?? undefined}
          onClick={() => void save()}
        >
          Save verdict
        </Button>
      </div>
    </div>
  );
};

export const ThumbDown = ({
  title,
  onSave,
}: {
  readonly title: string;
  readonly onSave: (draft: VerdictDraft) => Promise<boolean>;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Not a problem: ${title}`}
          data-testid="verdict-down"
          className={cn(open && "bg-fill-selected text-text-strong")}
        >
          <ThumbDownIcon size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-[340px] overflow-clip p-0">
        <Form
          onSave={async (draft) => {
            const saved = await onSave(draft);

            if (saved) setOpen(false);

            return saved;
          }}
        />
      </PopoverContent>
    </Popover>
  );
};

/**
 * The merge popover's pieces, built as the accept popover's are (Paper R7 8XC-0): radio
 * rows, checkbox rows, a hairline section and the sunken message well.
 */
import { cn, Input, Textarea } from "@polaris/ui";
import type { ReactNode } from "react";

const Radio = ({ on }: { readonly on: boolean }) => (
  <span
    aria-hidden="true"
    className={cn(
      "mt-[2px] size-[14px] shrink-0 rounded-full border-solid",
      on ? "border-text-strong border-[4.5px]" : "border-text-faint border-[1.5px]"
    )}
  />
);

export const Choice = ({
  on,
  title,
  caption,
  onPick,
  testId,
  autoFocus = false,
}: {
  readonly on: boolean;
  readonly title: string;
  readonly caption: string;
  readonly onPick: () => void;
  readonly testId?: string;
  readonly autoFocus?: boolean;
}) => (
  <button
    type="button"
    role="radio"
    autoFocus={autoFocus}
    aria-checked={on}
    onClick={onPick}
    data-testid={testId}
    className={cn(
      "rounded-control px-gap gap-row-x flex cursor-default items-start py-[7px] text-left",
      on ? "bg-fill-selected" : "hover:bg-fill-hover"
    )}
  >
    <Radio on={on} />
    <span className="flex min-w-0 flex-1 flex-col gap-px">
      <span className={cn("text-body", on ? "text-text-strong font-medium" : "text-text-default")}>
        {title}
      </span>
      <span className="text-caption text-text-subtle">{caption}</span>
    </span>
  </button>
);

export const Check = ({
  checked,
  label,
  caption,
  disabled = false,
  onChange,
  testId,
}: {
  readonly checked: boolean;
  readonly label: ReactNode;
  readonly caption: string;
  readonly disabled?: boolean;
  readonly onChange: (next: boolean) => void;
  readonly testId?: string;
}) => (
  <label
    className={cn(
      "rounded-control px-gap gap-row-x flex items-start py-[7px]",
      disabled && "opacity-(--opacity-dimmed)"
    )}
  >
    <input
      type="checkbox"
      data-testid={testId}
      className="mt-[3px] size-3.5 shrink-0 accent-current"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.currentTarget.checked)}
    />
    <span className="flex min-w-0 flex-col gap-px">
      <span className="text-body text-text-default min-w-0 truncate">{label}</span>
      <span className="text-caption text-text-subtle">{caption}</span>
    </span>
  </label>
);

export const Section = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) => (
  <div className="border-hairline flex flex-col gap-[2px] border-t px-[6px] py-2.5">
    <div className="px-gap text-caption text-text-faint pb-[6px]">{label}</div>
    {children}
  </div>
);

/** The commit message: title on one line, body under it. */
export const MessageWell = ({
  title,
  body,
  onChange,
}: {
  readonly title: string;
  readonly body: string;
  readonly onChange: (title: string, body: string) => void;
}) => (
  <div className="bg-surface-sunken border-hairline flex flex-col gap-1 rounded-[8px] border px-3 py-2">
    <Input
      aria-label="Commit title"
      data-testid="merge-title"
      value={title}
      onChange={(e) => onChange(e.currentTarget.value, body)}
      className="text-body text-text-strong h-auto border-0 bg-transparent px-0 py-0 font-medium shadow-none focus-visible:ring-0"
    />
    <Textarea
      bare
      aria-label="Commit message"
      data-testid="merge-body"
      value={body}
      placeholder="Add a description"
      onChange={(e) => onChange(title, e.currentTarget.value)}
      className="text-caption max-h-40 min-h-9"
    />
  </div>
);

/** A GitHub account's or team's initial in a circle (remote avatars are outside the CSP). */
export const Initial = ({ name, size = 20 }: { readonly name: string; readonly size?: number }) => (
  <span
    aria-hidden="true"
    style={{ width: size, height: size }}
    className="bg-fill-selected text-text-subtle text-micro ring-bg flex shrink-0 items-center justify-center rounded-full font-medium uppercase ring-[1.5px]"
  >
    {name.slice(0, 1)}
  </span>
);

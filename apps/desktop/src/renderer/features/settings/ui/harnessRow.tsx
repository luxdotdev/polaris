/**
 * The pieces of a Harness availability row (DESIGN.md, Settings · Harnesses;
 * Paper S1): the neutral status glyphs and the row's one action. Shared by
 * Settings → Harnesses and a Host's row in Settings → Hosts, so both say it
 * the same way.
 */
import { ArrowUpIcon, Button, CheckIcon, PixelTerminalIcon } from "@polaris/ui";
import type { ReactNode } from "react";
import type { RowAction, RowGlyph } from "../model/harnesses.ts";

const KeyGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
    <circle cx="5" cy="7" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
    <path
      d="M7.6 7H12.2M10.5 7v1.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
    />
  </svg>
);

export const GLYPHS: Readonly<Record<RowGlyph, ReactNode>> = {
  ready: <CheckIcon size={14} />,
  "sign-in": <KeyGlyph />,
  update: <ArrowUpIcon size={14} />,
  missing: (
    <span className="border-text-subtle mx-0.5 size-2.5 rounded-full border border-dashed" />
  ),
  unknown: <span className="bg-text-subtle mx-1 size-1.5 rounded-full" />,
};

export const Action = ({
  action,
  onSignIn,
}: {
  readonly action: RowAction;
  readonly onSignIn: () => void;
}) => {
  if (action.kind === "sign-in") {
    return (
      <Button variant="secondary" className="text-label gap-1.5 px-2.5" onClick={onSignIn}>
        <PixelTerminalIcon size={14} />
        Sign in in terminal
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      className="text-label text-text-default px-2.5"
      onClick={() => void window.polaris.request("shell.openExternal", { url: action.url })}
    >
      Open setup guide
    </Button>
  );
};

/**
 * Expanded (DESIGN.md, Visualizations V4): the same Visualization over the whole window at
 * `mode: expanded`. Esc or Close returns to the conversation where it was.
 */
import { Button, Kbd } from "@polaris/ui";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Frame } from "./Frame.tsx";
import { BarsGlyph } from "./glyphs.tsx";

export interface ExpandedProps {
  readonly id: string;
  readonly title: string;
  readonly html: string;
  /** "‹session title› · turn N"; null when the conversation doesn't say. */
  readonly where: string | null;
  readonly onClose: () => void;
  readonly onOpenLink: (url: string) => void;
  readonly onStopped: () => void;
}

export const Expanded = ({
  id,
  title,
  html,
  where,
  onClose,
  onOpenLink,
  onStopped,
}: ExpandedProps) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // macOS keeps its traffic lights over the bar's left end.
  const lights = document.documentElement.dataset.platform === "darwin";

  return createPortal(
    <div
      role="dialog"
      aria-modal
      aria-label={title}
      data-testid="visualization-expanded"
      className="bg-ground fixed inset-0 z-50 flex flex-col px-2 pb-2"
    >
      <div
        className="flex h-[52px] shrink-0 items-center gap-2.5 pr-1"
        style={{ paddingLeft: lights ? 80 : 8 }}
      >
        <BarsGlyph className="text-text-subtle" />
        <span className="text-text-strong min-w-0 truncate text-[14px] leading-[18px] font-medium">
          {title}
        </span>
        {where === null ? null : (
          <span className="text-caption text-text-subtle shrink-0">{where}</span>
        )}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
          Close
          <Kbd>esc</Kbd>
        </Button>
      </div>
      <div className="bg-panel flex min-h-0 flex-1 overflow-clip rounded-[16px] p-6">
        <Frame
          id={id}
          title={title}
          html={html}
          mode="expanded"
          onOpenLink={onOpenLink}
          onStopped={onStopped}
          className="h-full"
        />
      </div>
    </div>,
    document.body
  );
};

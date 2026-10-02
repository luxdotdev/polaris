/**
 * The tab strip (DESIGN.md, Editor: tabs; Paper E1): 36px tabs in `label`
 * type, the active one joined to the code, a dot for unsaved edits, a close
 * mark on the active tab, and a 12px dither while an agent changes the file.
 */
import { cn, CloseIcon, Dither } from "@polaris/ui";
import { type MouseEvent, useEffect, useRef } from "react";
import type { TabView } from "../runtime/hooks.ts";

export interface TabsProps {
  readonly tabs: ReadonlyArray<TabView>;
  readonly active: string | null;
  readonly onSelect: (path: string) => void;
  readonly onPin: (path: string) => void;
  readonly onClose: (path: string) => void;
}

/** The trailing 12px slot: the unsaved dot, swapped for the close mark on hover or when active. */
const TrailingSlot = ({
  tab,
  active,
  onClose,
}: {
  tab: TabView;
  active: boolean;
  onClose: () => void;
}) => {
  const close = (event: MouseEvent) => {
    event.stopPropagation();
    onClose();
  };

  return (
    <span className="relative flex size-3 shrink-0 items-center justify-center">
      {tab.dirty ? (
        <span
          aria-label="Unsaved"
          className="bg-text-subtle size-1.5 rounded-full group-hover/tab:invisible"
        />
      ) : null}
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Close ${tab.label}`}
        onClick={close}
        className={cn(
          "absolute inset-0 flex items-center justify-center rounded-[3px] text-text-subtle hover:text-text-default",
          active && !tab.dirty ? "visible" : "invisible group-hover/tab:visible"
        )}
      >
        <CloseIcon size={12} />
      </button>
    </span>
  );
};

export const Tabs = ({ tabs, active, onSelect, onPin, onClose }: TabsProps) => {
  const strip = useRef<HTMLDivElement>(null);

  // The active tab stays in view however many are open.
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, tabs.length]);

  return (
    <div
      ref={strip}
      role="tablist"
      aria-label="Open files"
      className="border-hairline bg-surface-sunken flex h-[37px] shrink-0 [scrollbar-width:none] overflow-x-auto border-b"
    >
      {tabs.map((tab) => {
        const selected = tab.path === active;

        return (
          <div
            key={tab.path}
            role="tab"
            tabIndex={selected ? 0 : -1}
            aria-selected={selected}
            title={tab.path}
            data-testid="editor-tab"
            data-dirty={tab.dirty ? "" : undefined}
            onMouseDown={(event) => {
              if (event.button === 1) onClose(tab.path);
            }}
            onClick={() => onSelect(tab.path)}
            onDoubleClick={() => onPin(tab.path)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelect(tab.path);
            }}
            className={cn(
              "group/tab flex h-9 max-w-[240px] shrink-0 cursor-default items-center gap-2 border-r border-hairline pr-3 pl-3.5 text-label select-none",
              selected
                ? "-mb-px h-[37px] bg-bg text-text-strong"
                : "text-text-subtle hover:text-text-default"
            )}
          >
            {tab.agent === null ? null : <Dither hue={tab.agent} size={12} moving />}
            <span className={cn("truncate", tab.preview && "italic")}>{tab.label}</span>
            <TrailingSlot tab={tab} active={selected} onClose={() => onClose(tab.path)} />
          </div>
        );
      })}
    </div>
  );
};

/**
 * The language server log tab (DESIGN.md, Editor: Language server log; Paper L6): read-only,
 * a toolbar with the server, counts as filters, Find, Wrap, Follow and Copy all, then mono lines.
 */
import { cn, CopyButton } from "@polaris/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { logKey, useServerLog, type LogLevel, type LogLine, type LogScope } from "./log.ts";
import {
  copyText,
  counts,
  levelText,
  matchParts,
  plural,
  timeText,
  visibleLines,
} from "./logModel.ts";
import { shortcutLabel } from "../../../../shared/chord.ts";

export interface LogViewProps {
  readonly scope: LogScope;
  /** "typescript-language-server 6.0.1" in mono. */
  readonly server: string;
  /** "· bundled TypeScript 6.0.3 · started 3m ago" after it. */
  readonly detail: string | null;
}

const ToolbarButton = ({
  pressed,
  onClick,
  children,
  label,
  strong,
}: {
  readonly pressed?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly label?: string;
  readonly strong?: boolean;
}) => (
  <button
    type="button"
    aria-pressed={pressed}
    aria-label={label}
    onClick={onClick}
    className={cn(
      "rounded-control text-caption focus-visible:outline-starlight flex h-6 shrink-0 items-center gap-1.5 px-2 focus-visible:outline-2",
      pressed || strong
        ? "bg-fill-selected text-text-strong"
        : "text-text-default hover:bg-fill-hover",
      strong && "px-2.5 font-medium"
    )}
  >
    {children}
  </button>
);

const LEVEL_CLASS: Readonly<Record<LogLine["level"], string>> = {
  error: "text-failed-text",
  warning: "text-severity-medium-text",
  info: "text-text-faint",
  debug: "text-text-faint",
};

const Line = ({ line, query, wrap }: { line: LogLine; query: string; wrap: boolean }) => (
  <div
    role="listitem"
    data-level={line.level}
    className={cn(
      "px-panel flex min-h-[22px] gap-4 font-mono text-[12px] leading-5",
      line.level === "error" && "bg-diff-removed-bg"
    )}
  >
    <span className="text-text-faint shrink-0 tabular-nums">{timeText(line.at)}</span>
    <span className={cn("w-10 shrink-0", LEVEL_CLASS[line.level])}>{levelText(line.level)}</span>
    <span
      className={cn(
        "min-w-0",
        wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre",
        line.level === "error" ? "text-failed-text" : "text-text-default"
      )}
    >
      {matchParts(line.text, query).map((part, index) =>
        part.match ? (
          <mark key={index} className="bg-fill-selected text-text-strong rounded-[2px]">
            {part.text}
          </mark>
        ) : (
          part.text
        )
      )}
    </span>
  </div>
);

const useFollow = (lines: number) => {
  const scroller = useRef<HTMLDivElement>(null);
  const top = useRef(0);
  const [follow, setFollow] = useState(true);

  useLayoutEffect(() => {
    const element = scroller.current;

    if (follow && element !== null) element.scrollTop = element.scrollHeight;
  }, [follow, lines]);

  const onScroll = () => {
    const element = scroller.current;

    // Only scrolling up stops following; a horizontal scroll or a new line never does.
    if (element === null || element.scrollTop >= top.current) {
      top.current = element?.scrollTop ?? 0;

      return;
    }

    top.current = element.scrollTop;
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 4;

    if (!atEnd && follow) setFollow(false);
  };

  return { scroller, follow, setFollow, onScroll };
};

export const LogView = ({ scope, server, detail }: LogViewProps) => {
  const log = useServerLog(logKey(scope));
  const lines = useMemo(() => log?.lines ?? [], [log]);
  const [only, setOnly] = useState<ReadonlySet<LogLevel>>(new Set());
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [wrap, setWrap] = useState(false);
  const find = useRef<HTMLInputElement>(null);
  const total = counts(lines);
  const shown = useMemo(() => visibleLines(lines, { only, query }), [lines, only, query]);
  const { scroller, follow, setFollow, onScroll } = useFollow(shown.length);

  useEffect(() => {
    if (finding) find.current?.focus();
  }, [finding]);

  const toggle = (level: "error" | "warning") =>
    setOnly((current) => {
      const next = new Set(current);

      if (next.has(level)) next.delete(level);
      else next.add(level);

      return next;
    });

  return (
    <section
      aria-label={`${server} log`}
      data-testid="language-log"
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
          event.preventDefault();
          setFinding(true);
          find.current?.focus();
        }
      }}
    >
      <div
        role="toolbar"
        aria-label="Log"
        className="border-hairline px-panel flex h-10 shrink-0 items-center gap-2 border-b"
      >
        <span className="text-caption text-text-default shrink-0 font-mono">{server}</span>
        <span className="text-caption text-text-subtle min-w-0 truncate">
          {["", detail, plural(lines.length, "line")].filter((part) => part !== null).join(" · ")}
        </span>
        <span className="flex-1" />
        <ToolbarButton pressed={only.has("error")} onClick={() => toggle("error")}>
          {total.errors > 0 ? <span className="bg-failed size-1.5 rounded-full" /> : null}
          {plural(total.errors, "error")}
        </ToolbarButton>
        <ToolbarButton pressed={only.has("warning")} onClick={() => toggle("warning")}>
          {plural(total.warnings, "warning")}
        </ToolbarButton>
        <span className="bg-hairline h-4 w-px shrink-0" />
        {finding ? (
          <input
            ref={find}
            aria-label="Find in log"
            placeholder="Find"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setQuery("");
                setFinding(false);
              }
            }}
            className="rounded-control border-hairline bg-surface-sunken text-caption text-text-default focus-visible:outline-starlight h-6 w-44 border px-2 font-mono focus-visible:outline-2"
          />
        ) : (
          <ToolbarButton onClick={() => setFinding(true)}>
            Find {shortcutLabel("CmdOrCtrl+F")}
          </ToolbarButton>
        )}
        <ToolbarButton pressed={wrap} onClick={() => setWrap((value) => !value)}>
          Wrap
        </ToolbarButton>
        <ToolbarButton pressed={follow} onClick={() => setFollow((value) => !value)}>
          <span
            aria-hidden
            className={cn(
              "size-3 rounded-[3px] border",
              follow ? "bg-text-strong border-text-strong" : "border-text-subtle"
            )}
          />
          Follow
        </ToolbarButton>
        <CopyButton
          text={() => copyText(shown)}
          label="Copy all"
          className="rounded-control text-text-strong h-6 px-2.5 font-medium"
        />
      </div>
      <div
        ref={scroller}
        onScroll={onScroll}
        role="list"
        aria-label="Log lines"
        aria-live={follow ? "polite" : "off"}
        className="min-h-0 flex-1 overflow-auto py-2"
      >
        {shown.length === 0 ? (
          <p className="px-panel text-caption text-text-subtle py-2">
            {lines.length === 0
              ? "Nothing logged yet. Lines appear here as the server writes them."
              : "No lines match."}
          </p>
        ) : (
          shown.map((line, index) => <Line key={index} line={line} query={query} wrap={wrap} />)
        )}
      </div>
    </section>
  );
};

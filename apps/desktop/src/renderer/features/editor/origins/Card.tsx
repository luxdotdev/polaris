/**
 * The Origins hover card (DESIGN.md, Origins; Paper O1–O3): the commit that last touched the
 * line and the sessions that wrote it, grouped by when, with the Hosts still answering or offline.
 */
import type { BlameCommit } from "@polaris/protocol";
import { Celestial, harnessTextVar, Kbd, Kicker, sessionCelestial } from "@polaris/ui";
import { type ReactNode, useEffect, useRef, useSyncExternalStore } from "react";
import { harnessName } from "../../session/model/polarisTools/words.ts";
import type { Lookup } from "./data.ts";
import {
  type CardRow,
  cardGroups,
  findingText,
  footerText,
  type LineSession,
  mergeLine,
  noSessions,
  openHint,
  rowTime,
  sessionDetail,
} from "./model.ts";

export interface CardProps {
  readonly line: number;
  readonly fileName: string;
  readonly commit: BlameCommit | null;
  /** Null for a line you edited and haven't saved: no Host is asked. */
  readonly lookup: Lookup | null;
  readonly now: number;
  readonly onOpenSession: (line: LineSession) => void;
  readonly onOpenCommit: (commit: BlameCommit) => void;
  readonly onClose: () => void;
}

const NO_HOSTS = { hosts: () => [], subscribe: () => () => undefined } satisfies Lookup;

const CommitGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="text-text-subtle">
    <circle cx="8" cy="8" r="2.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M1 8h4.25M10.75 8H15" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const OfflineGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="text-text-subtle">
    <path
      d="M3.5 3.5H2.75v7.75h10.5V6M6 14h4M8 11.25V14M6.5 3.5h6.75v3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
    />
    <path d="M1.5 1.5l13 13" stroke="currentColor" strokeWidth="1.25" />
  </svg>
);

const Spinner = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    aria-hidden="true"
    className="text-text-subtle motion-safe:animate-spin"
  >
    <circle
      cx="8"
      cy="8"
      r="6"
      fill="none"
      stroke="currentColor"
      strokeOpacity="0.25"
      strokeWidth="1.5"
    />
    <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const Slot = ({ children }: { readonly children: ReactNode }) => (
  <span className="flex w-6 shrink-0 items-center justify-center">{children}</span>
);

const ROW =
  "group/origin flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left outline-none hover:bg-fill-hover focus-visible:bg-fill-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-starlight";

const Hint = ({ text }: { readonly text: string }) => (
  <span className="text-caption text-text-default hidden shrink-0 items-center gap-1.5 group-hover/origin:flex group-focus-visible/origin:flex">
    {text}
    <Kbd>↵</Kbd>
  </span>
);

const Time = ({ text }: { readonly text: string }) => (
  <span className="text-caption text-text-subtle tabular w-[76px] shrink-0 text-right group-hover/origin:hidden group-focus-visible/origin:hidden">
    {text}
  </span>
);

const Lines = ({ title, detail }: { readonly title: string; readonly detail: ReactNode }) => (
  <span className="flex min-w-0 flex-1 flex-col">
    <span className="text-body text-text-strong truncate">{title}</span>
    <span className="text-caption text-text-subtle truncate">{detail}</span>
  </span>
);

const RowButton = ({
  row,
  now,
  onOpen,
}: {
  readonly row: CardRow;
  readonly now: number;
  readonly onOpen: () => void;
}) => {
  if (row.kind === "commit") {
    const { commit } = row;

    return (
      <button type="button" data-origin-row className={ROW} onClick={onOpen}>
        <Slot>
          <CommitGlyph />
        </Slot>
        <Lines
          title={commit.subject}
          detail={
            <>
              {commit.authorName} · <span className="font-mono">{commit.sha.slice(0, 7)}</span>
            </>
          }
        />
        <Time text={rowTime(row.time, now)} />
        <Hint text="Open diff" />
      </button>
    );
  }

  const { session } = row.line;

  return (
    <button type="button" data-origin-row className={ROW} onClick={onOpen}>
      <Slot>
        <Celestial
          body={sessionCelestial(session.celestial)}
          harness={session.harness}
          size={24}
          className={session.archived ? "opacity-45" : undefined}
        />
      </Slot>
      <Lines
        title={session.title}
        detail={
          <>
            <span style={{ color: harnessTextVar(session.harness) }}>
              {harnessName(session.harness)}
            </span>{" "}
            · {sessionDetail(row.line)}
          </>
        }
      />
      <Time text={rowTime(row.time, now)} />
      <Hint text={openHint(row.line)} />
    </button>
  );
};

const Note = ({ children }: { readonly children: ReactNode }) => (
  <p className="text-caption text-text-subtle py-1.5 pr-2 pl-10">{children}</p>
);

const Offline = ({ label }: { readonly label: string }) => (
  <div className="flex items-center gap-2 px-2 py-1.5">
    <Slot>
      <OfflineGlyph />
    </Slot>
    <Lines
      title={`${label} is offline`}
      detail="Its sessions can't be listed until it reconnects."
    />
  </div>
);

/** ↑↓ move between rows, ↵ opens (the button's own), esc closes. */
const onKeys = (card: HTMLElement, event: KeyboardEvent, onClose: () => void) => {
  const rows = [...card.querySelectorAll<HTMLButtonElement>("[data-origin-row]")];
  const at = rows.findIndex((row) => row === document.activeElement);

  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;

    rows[Math.min(rows.length - 1, Math.max(0, at + step))]?.focus();
  }
};

export const OriginsCard = (props: CardProps) => {
  const { line, fileName, commit, now, onClose } = props;
  const lookup = props.lookup ?? NO_HOSTS;
  const hosts = useSyncExternalStore(lookup.subscribe, lookup.hosts);
  const merged = mergeLine(line, hosts);
  const groups = cardGroups(commit, merged, now);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const card = root.current;

    if (card === null) return undefined;
    const keys = (event: KeyboardEvent) => onKeys(card, event, onClose);

    card.addEventListener("keydown", keys);

    return () => card.removeEventListener("keydown", keys);
  }, [onClose]);

  const open = (row: CardRow) =>
    row.kind === "commit" ? props.onOpenCommit(row.commit) : props.onOpenSession(row.line);

  return (
    <div
      ref={root}
      role="dialog"
      aria-label={`Line ${line}`}
      data-testid="origins-card"
      className="bg-raised border-hairline shadow-float flex w-[392px] flex-col overflow-hidden rounded-[14px] border font-sans"
    >
      <header className="flex items-baseline gap-2 px-4 pt-3 pb-1">
        <span className="text-text-strong min-w-0 flex-1 text-[14px] leading-5 font-medium">
          Line {line}
        </span>
        <span className="text-text-subtle truncate font-mono text-[12px]">{fileName}</span>
      </header>
      <div className="flex flex-col px-2 pb-2">
        {groups.map((group) => (
          <section key={group.kicker} className="flex flex-col">
            <Kicker className="px-2 pt-2 pb-1">{group.kicker}</Kicker>
            {group.rows.map((row) => (
              <RowButton
                key={
                  row.kind === "commit"
                    ? row.commit.sha
                    : `${row.line.hostKey}:${row.line.session.sessionId}`
                }
                row={row}
                now={now}
                onOpen={() => open(row)}
              />
            ))}
          </section>
        ))}
        {noSessions(merged) ? <Note>No session wrote this line.</Note> : null}
        {merged.pending > 0 ? (
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Slot>
              <Spinner />
            </Slot>
            <span className="text-caption text-text-subtle">{findingText(merged.pending)}</span>
          </div>
        ) : null}
        {merged.offline.length > 0 ? <div className="bg-hairline mx-2 my-1 h-px" /> : null}
        {merged.offline.map((label) => (
          <Offline key={label} label={label} />
        ))}
      </div>
      <footer className="bg-well border-hairline border-t px-4 py-2">
        <span className="text-text-subtle font-mono text-[11px] leading-[14px]">
          {footerText(commit, merged)}
        </span>
      </footer>
    </div>
  );
};

/**
 * The break-UI pass (ENG-499): Celestials, instrument cards, plain menus and popovers on
 * worst-case data. `?only=worst` sets them in every theme; `?only=worst-edges` opens a
 * popover and a menu against every window edge.
 */
import { CELESTIAL_MOONS, CELESTIAL_PLANETS, CELESTIAL_STARS } from "@polaris/protocol";
import type { ReactNode } from "react";

import {
  Button,
  Celestial,
  type CelestialSize,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuEntries,
  DropdownMenuTrigger,
  InstrumentCard,
  InstrumentPopoverContent,
  Kicker,
  MENU_SEPARATOR_ENTRY,
  type MenuEntryInput,
  Popover,
  PopoverTrigger,
  Row,
} from "../../src";
import { Section, Swatch } from "./layout";

const noop = () => undefined;

const SIZES: readonly CelestialSize[] = [16, 24, 32];

const BODIES = [...CELESTIAL_PLANETS, ...CELESTIAL_STARS, ...CELESTIAL_MOONS];

/** Every body at every size, still, Working and Dormant; an unknown body and Harness. */
function Celestials() {
  return (
    <Section title="Worst case · Celestials">
      {SIZES.map((size) => (
        <div key={size} className="flex flex-wrap items-end gap-2">
          {BODIES.map((body) => (
            <span key={body} className="flex flex-col gap-1">
              <Celestial body={body} harness="claude" size={size} />
              <Celestial body={body} harness="codex" size={size} working />
              <Celestial body={body} harness="opencode" size={size} dormant />
            </span>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-4">
        <Swatch label="unknown body">
          <Celestial body="comet-from-a-newer-daemon" harness="claude" size={24} />
        </Swatch>
        <Swatch label="unknown harness">
          <Celestial body="ringed" harness="cursor-agent" size={24} working />
        </Swatch>
        <Swatch label="working + dormant">
          <Celestial body="storm" harness="claude" size={24} working dormant />
        </Swatch>
      </div>
    </Section>
  );
}

const LONG_TITLE =
  "Investigate why the Daemon’s event store replays every Turn twice after a crash";

/** Rows the way the sidebar sets them: 14 sessions on 12 planets, with forks and moons. */
function RowsOfBodies() {
  const rows: ReadonlyArray<readonly [string, string, ReactNode]> = [
    ["ringed", "claude", LONG_TITLE],
    [
      "ringed",
      "codex",
      "セッションストアのホットパスを調査して、長い再生で支配的なフォールドを報告する",
    ],
    ["banded", "claude", "تحقق من سبب فشل اختبارات المتجر تحت الحمل"],
    ["star-cross", "claude", "🔥 Lead: Release polish 🧪🐛👩‍💻"],
    ["moon-crescent", "claude", "Subagent of a subagent: read the Codex driver"],
  ];

  return (
    <div className="flex w-[288px] flex-col gap-0.5">
      {rows.map(([body, harness, title], n) => (
        <Row
          key={n}
          variant="session"
          leading={<Celestial body={body} harness={harness} size={24} working={n === 1} />}
          title={title}
          description="Wants to run bun test apps/daemon/src/verification --rerun-each 50"
          meta="412d"
          tone={n === 0 ? "needs-you" : "default"}
          selected={n === 0}
        />
      ))}
    </div>
  );
}

const WELL_ROWS = (
  <dl className="text-caption grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 p-3">
    <dt className="text-text-subtle min-w-0 truncate">Tokens across 1,284 Turns in 37 sessions</dt>
    <dd className="tabular text-text-default">1,284,093,442</dd>
    <dt className="text-text-subtle min-w-0 truncate">Spend</dt>
    <dd className="tabular text-text-default">$12,840.07</dd>
  </dl>
);

const EMPTY_WELL = <p className="text-caption text-text-subtle p-3">Nothing here yet</p>;

const CARDS = {
  huge: {
    header: {
      title: "northwind-industries-holdings-customer-portal-monorepo · Release polish",
      state: "1,284 workers",
      control: (
        <Button size="xs" variant="ghost">
          By Constellation
        </Button>
      ),
    },
    wells: [WELL_ROWS, WELL_ROWS],
    footer: {
      status: "As of 22:25 · revision 1,284,093 · 12 tasks waiting on a gate",
      action: (
        <Button size="xs" variant="ghost">
          Open the full report in Settings
        </Button>
      ),
    },
  },
  empty: {
    header: { title: "Stats", state: "0 workers" },
    wells: [EMPTY_WELL],
    footer: { status: "No revision yet" },
  },
} as const;

/** Huge counts, long labels and an empty well. */
function Cards() {
  return (
    <Section title="Worst case · Instrument cards">
      <div className="flex flex-wrap items-start gap-4">
        <InstrumentCard {...CARDS.huge} />
        <InstrumentCard {...CARDS.empty} />
        <InstrumentCard
          header={{ title: "Kicker" }}
          wells={[
            <div key="k" className="flex flex-col gap-1 p-3">
              <Kicker parts={["As of 22:25", "revision 1,284,093", LONG_TITLE]} />
            </div>,
          ]}
        />
      </div>
    </Section>
  );
}

const MENU: ReadonlyArray<MenuEntryInput> = [
  { kind: "label", text: "Move to northwind-industries-holdings-customer-portal-monorepo" },
  { kind: "item", label: "Open in a new window", onSelect: noop, shortcut: "⌥⌘⇧N" },
  { kind: "item", label: LONG_TITLE, onSelect: noop, shortcut: "⌘1" },
  { kind: "item", label: "ドキュメント翻訳に移動", onSelect: noop },
  {
    kind: "item",
    label: "Merge",
    onSelect: noop,
    disabled: true,
    reason: "Needs a review approval from a code owner first",
  },
  MENU_SEPARATOR_ENTRY,
  { kind: "item", label: "Archive", onSelect: noop, destructive: true },
];

/** Plain menu with long labels, a long kicker and a long disabled reason, open in place. */
function Menus() {
  return (
    <Section title="Worst case · Menus">
      <div className="h-[340px]">
        <DropdownMenu open>
          <DropdownMenuTrigger asChild>
            <Button>Menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuEntries entries={MENU} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Section>
  );
}

export function WorstSection() {
  return (
    <>
      <Celestials />
      <RowsOfBodies />
      <Cards />
      <Menus />
    </>
  );
}

const PLACES = [
  "top-3 left-3",
  "top-3 right-3",
  "bottom-3 left-3",
  "bottom-3 right-3",
  "top-1/2 left-3",
  "top-1/2 right-3",
] as const;

/** A tall instrument popover and a menu against each window edge (rule/popover-fits-window). */
export function WorstEdges({ menus }: { readonly menus: boolean }) {
  return (
    <div className="relative h-screen w-screen">
      {PLACES.map((place) => (
        <div key={place} className={`absolute ${place}`}>
          {menus ? (
            <DropdownMenu open>
              <DropdownMenuTrigger asChild>
                <Button size="xs">Menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuEntries entries={[...MENU, ...MENU, ...MENU]} />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Popover open>
              <PopoverTrigger asChild>
                <Button size="xs">Card</Button>
              </PopoverTrigger>
              <InstrumentPopoverContent side="bottom" {...CARDS.huge} />
            </Popover>
          )}
        </div>
      ))}
    </div>
  );
}

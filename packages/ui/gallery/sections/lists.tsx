import { useState } from "react";

import {
  BranchIcon,
  Chip,
  Dither,
  FolderIcon,
  HarnessMark,
  PixelFailedIcon,
  PixelHandIcon,
  PlusIcon,
  Row,
  SectionHeader,
  SegmentedControl,
  StateIcon,
} from "../../src";
import { Section } from "./layout";

type Mode = "orchestrate" | "review" | "edit";

export function ListSection() {
  const [mode, setMode] = useState<Mode>("orchestrate");
  const [view, setView] = useState<"sessions" | "needs-you">("sessions");

  return (
    <Section title="Segmented controls, chips and rows">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label="Mode"
          value={mode}
          onValueChange={setMode}
          options={[
            {
              value: "orchestrate",
              label: "Orchestrate",
              badge: (
                <span className="rounded-control bg-needs-you/16 text-micro text-needs-you flex h-[18px] min-w-[18px] items-center justify-center px-1 font-medium">
                  2
                </span>
              ),
            },
            {
              value: "review",
              label: "Review",
              badge: <span className="text-micro font-regular text-text-faint">3</span>,
            },
            { value: "edit", label: "Edit" },
          ]}
        />
        <div className="w-[231px]">
          <SegmentedControl
            aria-label="Sidebar view"
            variant="fill"
            value={view}
            onValueChange={setView}
            options={[
              { value: "sessions", label: "Sessions" },
              {
                value: "needs-you",
                label: "Needs you",
                badge: <span className="text-micro text-needs-you">2</span>,
              },
            ]}
          />
        </div>
      </div>
      <div className="rounded-control bg-surface-sunken flex flex-wrap items-center gap-1 p-1.5">
        <span className="text-caption text-text-faint px-1.5">Mac Studio</span>
        <Chip
          selected
          needsYou={1}
          shortcut="⌃1"
          leading={<Dither hue="claude" size={12} moving />}
        >
          polaris
        </Chip>
        <Chip shortcut="⌃2" leading={<StateIcon state="idle" harness="claude" size={12} />}>
          sightline
        </Chip>
        <Chip
          needsYou={1}
          shortcut="⌃4"
          leading={<PixelHandIcon size={12} className="text-needs-you" />}
        >
          nj-homes-choice-next
        </Chip>
        <Chip shortcut="⌃6" leading={<PixelFailedIcon size={12} className="text-failed" />}>
          code
        </Chip>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip variant="source" leading={<BranchIcon size={14} className="text-text-subtle" />}>
          #212
        </Chip>
        <Chip variant="source">
          <span className="text-micro font-regular font-mono">CONTEXT.md</span>
        </Chip>
        <Chip variant="add">+ Add</Chip>
      </div>
      <div className="rounded-row bg-surface-sunken flex w-[264px] flex-col gap-0.5 p-2">
        <SectionHeader action={<PlusIcon className="text-text-subtle" />}>Sessions</SectionHeader>
        <Row
          variant="session"
          tone="needs-you"
          leading={<HarnessMark harness="codex" size={28} state="needs-you" />}
          title="Spike GPUI review screen"
          description="Wants to run cargo build"
          meta="42m"
        />
        <Row
          variant="session"
          selected
          leading={<HarnessMark harness="claude" size={28} state="working" />}
          title="Polaris planning"
          description="Writing layout variants…"
          meta="5h"
        />
        <Row
          variant="session"
          leading={<HarnessMark harness="claude" size={28} state="idle" />}
          title="Orchestrator layout prototype with a very long title"
          description="Ready to review · 3 files"
          meta="3h"
        />
        <Row
          variant="session"
          tone="quiet"
          leading={<HarnessMark harness="claude" size={28} state="dormant" />}
          title="Glossary first pass"
          description="Dormant · resumes on reply"
          meta="1d"
        />
        <SectionHeader>Needs you elsewhere</SectionHeader>
        <Row
          leading={<PixelHandIcon size={14} className="text-needs-you" />}
          title="Fix eligibility form validation"
          meta="Linux VM"
        />
        <Row
          leading={<FolderIcon className="text-text-subtle" />}
          title="polaris"
          meta="⌃1"
          selected
        />
        <Row variant="tree" title="src/components" meta="3" />
        <SectionHeader empty="None in polaris">Worktrees</SectionHeader>
      </div>
    </Section>
  );
}

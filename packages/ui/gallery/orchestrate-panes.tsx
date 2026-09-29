import type { ReactNode } from "react";

import {
  Button,
  CheckIcon,
  Chip,
  ChevronDownIcon,
  ChevronRightIcon,
  Composer,
  Dither,
  HarnessMark,
  IconButton,
  Kbd,
  PixelHandIcon,
  PlusIcon,
  Row,
  SectionHeader,
  SegmentedControl,
  SeverityBadge,
  SeverityGlyph,
  ThumbDownIcon,
  ThumbUpIcon,
} from "../src";

export function Sidebar() {
  return (
    <aside className="border-hairline bg-surface-sunken flex w-[264px] shrink-0 flex-col border-r">
      <div className="flex flex-col gap-3 px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-heading text-text-strong">polaris</p>
            <p className="text-caption text-text-faint">Mac Studio · ~/code/polaris</p>
          </div>
          <IconButton label="New session" icon={<PlusIcon />} shortcut="⌘N" />
        </div>
        <SegmentedControl
          aria-label="Sidebar view"
          variant="fill"
          value="sessions"
          onValueChange={() => undefined}
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
      <div className="flex flex-col gap-0.5 px-2 pt-2">
        <SectionHeader>Sessions</SectionHeader>
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
          title="Orchestrator layout prototype"
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
      </div>
      <div className="flex flex-col gap-2 px-4 pt-4">
        <p className="text-caption text-text-subtle">Sources · Polaris planning</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip variant="source" leading={<span className="bg-text-faint size-3.5 rounded-full" />}>
            ENG-177
          </Chip>
          <Chip variant="source">#212</Chip>
          <Chip variant="source">
            <span className="text-micro font-regular font-mono">CONTEXT.md</span>
          </Chip>
          <Chip variant="add">+ Add</Chip>
        </div>
      </div>
      <div className="flex flex-col px-2 pt-4">
        <SectionHeader>Needs you elsewhere</SectionHeader>
        <Row
          leading={<PixelHandIcon size={14} className="text-needs-you" />}
          title="Fix eligibility form validation"
          meta="Linux VM"
        />
      </div>
      <span className="flex-1" />
      <div className="border-hairline flex h-10 shrink-0 items-center gap-2 border-t px-4">
        <Kbd>K</Kbd>
        <span className="text-caption text-text-subtle">Jump</span>
        <span className="flex-1" />
        <span className="text-caption text-text-faint">4 sessions · 1 worktree</span>
      </div>
    </aside>
  );
}

function Step({
  done,
  children,
  meta,
}: {
  readonly done: boolean;
  readonly children: ReactNode;
  readonly meta?: string;
}) {
  return (
    <div className="flex h-[30px] items-center gap-2.5 px-3">
      {done ? (
        <CheckIcon size={14} className="text-text-subtle" />
      ) : (
        <span className="flex w-3.5 justify-center">
          <span className="border-text-faint size-2 rounded-full border" />
        </span>
      )}
      <span
        className={`text-label font-regular flex-1 ${done ? "text-text-subtle" : "text-text-faint"}`}
      >
        {children}
      </span>
      {meta === undefined ? null : <span className="text-caption text-text-faint">{meta}</span>}
    </div>
  );
}

export function Intent() {
  return (
    <section className="border-hairline bg-bg flex w-[448px] shrink-0 flex-col border-r">
      <header className="border-hairline flex flex-col gap-2.5 border-b px-5 pt-4 pb-3.5">
        <h1 className="text-title text-text-strong">Polaris planning</h1>
        <div className="flex items-center gap-3">
          <HarnessMark harness="claude" named state="working" />
          <span className="text-caption text-text-subtle">Working · turn 24</span>
          <span className="flex-1" />
          <span className="text-caption text-text-faint">Context 17%</span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-5">
        <div className="rounded-row border-hairline bg-surface-raised/50 flex h-10 shrink-0 items-center gap-2.5 border px-3">
          <span className="text-caption text-text-subtle font-medium">Turn 23</span>
          <span className="text-body text-text-subtle flex-1 truncate">
            Recorded the Review decision, closed ENG-185
          </span>
          <span className="text-code-inline text-diff-added font-mono">+6</span>
          <span className="text-code-inline text-diff-removed font-mono">−1</span>
          <ChevronRightIcon size={10} className="text-text-faint" />
        </div>
        <p className="rounded-card bg-fill-selected text-body text-text-strong max-w-[340px] self-end px-3.5 py-2.5">
          Let's go on to 177. Prototype the Orchestrator layouts so I can compare them side by side.
        </p>
        <div className="flex gap-3">
          <HarnessMark harness="claude" size={24} state="working" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="text-body text-text-subtle flex h-6 items-center gap-2">
              Thought for 6s <ChevronRightIcon size={10} className="text-text-faint" />
            </div>
            <p className="text-body text-text-default">
              I'll build four structurally different variants from the same mock data, so you can
              flip between them with ← and →.
            </p>
            <div className="rounded-row border-hairline bg-surface-raised/50 flex flex-col border py-1.5">
              <Step done>Moved ENG-177 to In Progress</Step>
              <Step done meta="4 files">
                Read the Orchestrator notes and mock data
              </Step>
              <div className="bg-harness-claude-code/6 flex h-[30px] items-center gap-2.5 px-3">
                <Dither hue="claude" size={14} moving />
                <span className="text-label text-text-strong flex-1">Writing index.html</span>
                <span className="text-caption text-text-subtle">variant 3 of 4</span>
              </div>
              <Step done={false}>Publish the prototype as an artifact</Step>
            </div>
          </div>
        </div>
      </div>
      <div className="px-4 pb-4">
        <Composer
          harness="claude"
          model="Opus 5"
          branch="main"
          working={{ elapsed: "1m 12s", onStop: () => undefined }}
        />
      </div>
    </section>
  );
}

const DIFF_FILLS = { "+": "bg-diff-added-bg", "−": "bg-diff-removed-bg", "": "" } as const;

function DiffLine({
  n,
  sign,
  children,
  flag,
}: {
  readonly n: number | "";
  readonly sign: "+" | "−" | "";
  readonly children: string;
  readonly flag?: boolean;
}) {
  const fill = DIFF_FILLS[sign];

  return (
    <div className={`text-code-inline flex h-[22px] items-center font-mono leading-5 ${fill}`}>
      <span className="flex w-[22px] justify-center">
        {flag === true ? <SeverityGlyph severity="critical" /> : null}
      </span>
      <span className="text-text-faint w-[30px] text-right">{n}</span>
      <span
        className={`w-[22px] text-center ${sign === "+" ? "text-diff-added" : "text-diff-removed"}`}
      >
        {sign}
      </span>
      <span className="text-text-default flex-1 truncate whitespace-pre">{children}</span>
    </div>
  );
}

export function Output() {
  return (
    <section className="bg-bg flex min-w-0 flex-1 flex-col">
      <div className="border-hairline flex h-11 shrink-0 items-center gap-1 border-b px-3">
        <Button variant="secondary" className="text-text-strong">
          Changes
        </Button>
        <Button variant="ghost">Preview</Button>
        <Button variant="ghost">Files</Button>
        <Button variant="ghost">
          Risk <SeverityBadge severity="critical" count={1} className="text-micro h-4 px-[5px]" />
        </Button>
        <span className="flex-1" />
        <span className="text-caption text-text-subtle">Turn 24</span>
        <span className="text-caption text-text-faint">· 3 files</span>
        <span className="text-code-inline text-diff-added font-mono">+88</span>
        <span className="text-code-inline text-diff-removed font-mono">−14</span>
        <span className="w-3" />
        <Button>
          Open in Review <Kbd variant="plain">⌘2</Kbd>
        </Button>
      </div>
      <div className="flex flex-col gap-4 overflow-hidden p-4">
        <div className="rounded-row border-hairline bg-surface-sunken overflow-clip border">
          <div className="border-hairline flex h-9 items-center gap-2.5 border-b px-3">
            <ChevronDownIcon size={12} className="text-text-subtle" />
            <span className="text-code-inline text-text-default font-mono">
              prototypes/orchestrator-layout/serve.ts
            </span>
            <span className="text-code-inline text-diff-added font-mono">+4</span>
            <span className="text-code-inline text-diff-removed font-mono">−1</span>
            <span className="flex-1" />
            <SeverityBadge severity="critical" />
          </div>
          <div className="flex flex-col py-1.5">
            <DiffLine n={1} sign="">{`import { publish } from "./artifact";`}</DiffLine>
            <DiffLine n="" sign="−">
              const ARTIFACT_URL = process.env.ARTIFACT_URL;
            </DiffLine>
            <DiffLine
              n={3}
              sign="+"
            >{`const ARTIFACT_URL = "https://claude.ai/artifact/V6EMS2kK78";`}</DiffLine>
            <DiffLine n={4} sign="+" flag>{`const API_TOKEN = "sk-ant-api03-Xk2P…m9fQ";`}</DiffLine>
            <div className="rounded-row border-hairline bg-surface-raised my-2 mr-4 ml-[52px] flex flex-col gap-2 border p-3">
              <div className="flex items-center gap-2">
                <SeverityBadge severity="critical" />
                <span className="text-label text-text-strong flex-1">
                  Secret-like value committed
                </span>
                <span className="text-caption text-text-faint">Rule · 97%</span>
              </div>
              <p className="text-body text-text-subtle">
                An Anthropic API key is hard-coded and will ship with the prototype. Read it from
                the environment instead. No Risk Memory can hide this.
              </p>
              <div className="flex items-center gap-1">
                <Button size="sm">Ask Claude Code to fix</Button>
                <span className="flex-1" />
                <IconButton size="sm" label="Looks right" icon={<ThumbUpIcon size={14} />} />
                <IconButton size="sm" label="Not a problem" icon={<ThumbDownIcon size={14} />} />
              </div>
            </div>
            <DiffLine n={6} sign="">
              {"export async function main() {"}
            </DiffLine>
            <DiffLine n={7} sign="+">
              {"  await publish(ARTIFACT_URL, { token: API_TOKEN });"}
            </DiffLine>
          </div>
        </div>
        <div className="rounded-row border-hairline bg-surface-sunken flex h-9 items-center gap-2.5 border px-3">
          <ChevronDownIcon size={12} className="text-text-subtle" />
          <span className="text-code-inline text-text-default font-mono">
            prototypes/orchestrator-layout/index.html
          </span>
          <span className="text-code-inline text-diff-added font-mono">+78</span>
          <span className="text-code-inline text-diff-removed font-mono">−12</span>
          <span className="flex-1" />
          <SeverityBadge severity="high" />
          <SeverityBadge severity="medium" />
        </div>
        <div className="rounded-row border-hairline bg-surface-sunken flex h-9 items-center gap-2.5 border px-3">
          <ChevronRightIcon size={12} className="text-text-subtle" />
          <span className="text-code-inline text-text-default font-mono">CONTEXT.md</span>
          <span className="text-code-inline text-diff-added font-mono">+6</span>
          <span className="text-code-inline text-diff-removed font-mono">−1</span>
          <span className="flex-1" />
          <span className="text-caption text-text-faint">38%</span>
          <SeverityBadge severity="low" lowConfidence />
        </div>
      </div>
    </section>
  );
}

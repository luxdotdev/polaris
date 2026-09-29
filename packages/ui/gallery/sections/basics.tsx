import {
  Badge,
  Button,
  IconButton,
  Input,
  Kbd,
  PlusIcon,
  SearchIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  Textarea,
  ThumbDownIcon,
  ThumbUpIcon,
} from "../../src";
import { Section, Swatch } from "./layout";

const TYPE_ROLES = [
  ["display", "text-display", "What should happen next?"],
  ["title", "text-title", "Polaris planning"],
  ["heading", "text-heading", "Codex needs you"],
  ["heading-sm", "text-heading-sm", "Nothing needs you"],
  ["body", "text-body", "I'll build four structurally different variants from the same mock data."],
  ["label", "text-label", "Spike GPUI review screen"],
  ["caption", "text-caption", "Mac Studio · ~/code/polaris · 42m"],
] as const;

export function TypeSection() {
  return (
    <Section title="Type">
      <div className="flex flex-col gap-2">
        {TYPE_ROLES.map(([role, scale, sample]) => (
          <div key={role} className="flex items-baseline gap-4">
            <span className="text-caption text-text-faint w-20 shrink-0">{role}</span>
            <span className={`${scale} text-text-strong`}>{sample}</span>
          </div>
        ))}
        <div className="flex items-baseline gap-4">
          <span className="text-caption text-text-faint w-20 shrink-0">code</span>
          <span className="text-code font-mono">const API_TOKEN = process.env.API_TOKEN;</span>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="text-caption text-text-faint w-20 shrink-0">code-inline</span>
          <span className="text-code-inline text-text-default font-mono">spike/gpui-review</span>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="text-caption text-text-faint w-20 shrink-0">text colours</span>
          <span className="text-label text-text-strong">strong</span>
          <span className="text-label text-text-default">default</span>
          <span className="text-label text-text-subtle">subtle</span>
          <span className="text-label text-text-faint">faint</span>
        </div>
      </div>
    </Section>
  );
}

const SURFACES = [
  ["surface-sunken", "bg-surface-sunken"],
  ["bg", "bg-bg"],
  ["surface-raised", "bg-surface-raised"],
  ["fill-hover", "bg-fill-hover"],
  ["fill-selected", "bg-fill-selected"],
  ["row-selected", "bg-row-selected"],
] as const;

const SIGNALS = [
  ["starlight", "bg-starlight"],
  ["needs-you", "bg-needs-you"],
  ["failed", "bg-failed"],
  ["claude code", "bg-harness-claude-code"],
  ["codex", "bg-harness-codex"],
  ["diff +", "bg-diff-added"],
  ["diff −", "bg-diff-removed"],
  ["git M", "bg-git-modified"],
] as const;

export function ColourSection() {
  return (
    <Section title="Surfaces and signals">
      <div className="flex flex-wrap gap-3">
        {SURFACES.map(([label, fill]) => (
          <Swatch key={label} label={label}>
            <span className={`rounded-control border-hairline block h-10 w-20 border ${fill}`} />
          </Swatch>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {SIGNALS.map(([label, fill]) => (
          <Swatch key={label} label={label}>
            <span className={`rounded-control block h-6 w-14 ${fill}`} />
          </Swatch>
        ))}
      </div>
    </Section>
  );
}

export function ControlsSection() {
  return (
    <Section title="Buttons, keys and fields">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary">Approve</Button>
        <Button>Open session</Button>
        <Button variant="ghost">Deny</Button>
        <Button variant="danger">Remove host</Button>
        <Button variant="primary" disabled>
          Accept paused · 1 critical
        </Button>
        <Button size="sm">Open in Review</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <IconButton label="New session" icon={<PlusIcon />} shortcut="⌘N" />
        <IconButton label="Search" icon={<SearchIcon />} />
        <IconButton label="Looks right" icon={<ThumbUpIcon />} />
        <IconButton label="Not a problem" icon={<ThumbDownIcon />} />
        <Separator orientation="vertical" className="h-4" />
        <Kbd>K</Kbd>
        <Kbd>⌘</Kbd>
        <Kbd variant="plain">⌃1</Kbd>
        <Kbd variant="plain">esc</Kbd>
        <Separator orientation="vertical" className="h-4" />
        <Badge>New</Badge>
        <Badge tone="needs-you">2 need you</Badge>
        <Badge tone="failed">Failed</Badge>
        <Badge tone="needs-you" size="count">
          1
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input placeholder="Jump to a session or workspace" />
        <Input defaultValue="~/code/polaris" />
        <Select defaultValue="opus">
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="opus">Opus 5</SelectItem>
            <SelectItem value="sonnet">Sonnet 5</SelectItem>
            <SelectItem value="haiku">Haiku 4.5</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-caption text-text-subtle flex items-center gap-4">
          <label className="flex items-center gap-2">
            <Switch defaultChecked /> Follow
          </label>
          <label className="flex items-center gap-2">
            <Switch /> Completions
          </label>
          <label className="flex items-center gap-2">
            <Switch disabled /> Disabled
          </label>
        </div>
        <Textarea className="col-span-2" placeholder="Why is this not a problem?" />
      </div>
    </Section>
  );
}

/**
 * Settings → Reviewer's lower half (Paper S7): "When it runs" (pull requests, Agent
 * Sessions, and asking first above a size) and "What it checks against" (the Rules and
 * the review instructions), with the way to Usage.
 */
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@polaris/ui";
import { useShellActions } from "../../../shell/hooks.ts";
import { type RunPolicy, THRESHOLDS, thresholdLabel } from "../model/reviewer.ts";
import { Group, Heading, SettingRow } from "./parts.tsx";

const NEVER = "never";

const ThresholdSelect = ({
  value,
  onChange,
}: {
  readonly value: number | null;
  readonly onChange: (lines: number | null) => void;
}) => (
  <Select
    value={value === null ? NEVER : String(value)}
    onValueChange={(v) => onChange(v === NEVER ? null : Number(v))}
  >
    <SelectTrigger
      id="ask-first"
      aria-label="Ask first for large changes"
      className="text-caption bg-surface-sunken h-tree-row px-2.5"
    >
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {THRESHOLDS.map((lines) => (
        <SelectItem key={lines ?? NEVER} value={lines === null ? NEVER : String(lines)}>
          {thresholdLabel(lines)}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

export const WhenItRuns = ({
  policy,
  onChange,
}: {
  readonly policy: RunPolicy;
  readonly onChange: (patch: Partial<RunPolicy>) => void;
}) => (
  <section aria-label="When it runs" className="flex flex-col gap-3">
    <Heading>When it runs</Heading>
    <Group>
      <SettingRow
        title="When a pull request opens in Review"
        caption="Kept per head commit; new commits are reviewed on their own"
        htmlFor="run-on-pulls"
      >
        <Switch
          id="run-on-pulls"
          checked={policy.onPullRequests}
          onCheckedChange={(on) => onChange({ onPullRequests: on })}
        />
      </SettingRow>
      <SettingRow
        title="When you open an agent session in Review or accept its turns"
        caption="Rules still run after every turn"
        htmlFor="run-on-sessions"
      >
        <Switch
          id="run-on-sessions"
          checked={policy.onSessions}
          onCheckedChange={(on) => onChange({ onSessions: on })}
        />
      </SettingRow>
      <SettingRow
        title="Ask first for large changes"
        caption="Rules run at once; the reviewer waits for “Run reviewer”"
        htmlFor="ask-first"
      >
        <ThresholdSelect
          value={policy.askAboveLines}
          onChange={(lines) => onChange({ askAboveLines: lines })}
        />
      </SettingRow>
    </Group>
  </section>
);

const CheckRow = ({
  name,
  what,
  aside,
}: {
  readonly name: string;
  readonly what: string;
  readonly aside: string;
}) => (
  <div className="px-panel min-h-session-row flex items-center gap-[var(--spacing-panel)]">
    <span className="text-body text-text-default w-[180px] shrink-0">{name}</span>
    <span className="text-caption text-text-subtle min-w-0 flex-1">{what}</span>
    <span className="text-caption text-text-subtle shrink-0">{aside}</span>
  </div>
);

/** The Daemon's built-in ast-grep pack (apps/daemon/src/rules/README.md). */
const BUILT_IN_PATTERNS = 28;

export const ChecksAgainst = () => {
  const { openSettings } = useShellActions();

  return (
    <section aria-label="What it checks against" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Heading>What it checks against</Heading>
        <p className="text-body text-text-subtle">
          Rules run on the host without the reviewer and use no tokens. No rule or instruction can
          hide a critical finding.
        </p>
      </div>
      <Group>
        <CheckRow
          name="Secrets"
          what="Keys, tokens and credentials · critical, weak matches medium"
          aside="Always on"
        />
        <CheckRow
          name="Dangerous patterns"
          what={`${BUILT_IN_PATTERNS} built-in · TypeScript, Python, Go, Rust, shell`}
          aside="Always on"
        />
        <CheckRow
          name="Review instructions"
          what=".polaris/review.md, and a private file on each host"
          aside="Read every run"
        />
      </Group>
      <div className="flex items-center gap-2 px-1">
        <span className="text-caption text-text-subtle flex-1">
          The reviewer&apos;s tokens count in Usage and plan limits like any session&apos;s.
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="text-text-default"
          onClick={() => openSettings("usage")}
        >
          Open usage
        </Button>
      </div>
    </section>
  );
};

/**
 * Settings → Sessions, "Compact idle sessions" (ENG-562) and its threshold, "Only above [200]k
 * context tokens". One setting for every host: the Desktop App writes it to each.
 */
import { MIN_IDLE_COMPACTION_TOKENS } from "@polaris/protocol";
import { cn, Input, Switch } from "@polaris/ui";
import { useState } from "react";
import { setSessionPrefs, useSettings } from "../store.ts";
import { SettingRow } from "./parts.tsx";

const MIN_K = MIN_IDLE_COMPACTION_TOKENS / 1000;

/** Thousands of tokens, 50 to 9,999, as the field takes them; null for anything else. */
const parseThousands = (text: string): number | null => {
  const trimmed = text.trim();

  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const thousands = Number(trimmed);

  return thousands >= MIN_K ? thousands : null;
};

/** Saved on blur or ↵ when it is a whole number of thousands; otherwise it keeps the old one. */
const ThousandsField = ({
  enabled,
  minTokens,
}: {
  readonly enabled: boolean;
  readonly minTokens: number;
}) => {
  const [draft, setDraft] = useState(String(Math.round(minTokens / 1000)));
  const parsed = parseThousands(draft);

  const save = () => {
    if (parsed !== null && parsed * 1000 !== minTokens)
      setSessionPrefs({ idleCompaction: { enabled, minTokens: parsed * 1000 } });
  };

  return (
    <Input
      id="idle-compaction-tokens"
      aria-label="Thousand tokens"
      className="h-7 w-16 text-center tabular-nums"
      inputMode="numeric"
      value={draft}
      disabled={!enabled}
      aria-invalid={parsed === null}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") save();
      }}
    />
  );
};

export const IdleCompaction = () => {
  const { enabled, minTokens } = useSettings((s) => s.sessions.idleCompaction);

  return (
    <div>
      <SettingRow
        title="Compact idle sessions"
        caption="After 55 minutes idle, while the prompt cache is still warm, so the summary costs little. On every host; never while a session works or needs you."
        htmlFor="idle-compaction"
      >
        <Switch
          id="idle-compaction"
          checked={enabled}
          onCheckedChange={(on) => setSessionPrefs({ idleCompaction: { enabled: on, minTokens } })}
        />
      </SettingRow>
      <div
        className={cn(
          "px-panel gap-row-x text-label text-text-default -mt-1 flex items-center pb-[calc(var(--spacing-gap)+4px)]",
          !enabled && "opacity-(--opacity-dimmed)"
        )}
      >
        <label htmlFor="idle-compaction-tokens">Only sessions holding at least</label>
        <ThousandsField key={minTokens} enabled={enabled} minTokens={minTokens} />
        <span>k context tokens</span>
      </div>
    </div>
  );
};

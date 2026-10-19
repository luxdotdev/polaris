/**
 * Settings → Sessions, "Notify when a turn finishes" and its narrower option, "Only turns
 * longer than [5] minutes", which only applies while the main switch is on.
 */
import { clientCopy } from "../../../../shared/clientCopy.ts";
import { cn, Input, Switch } from "@polaris/ui";
import { useState } from "react";
import { setSessionPrefs, useSettings } from "../store.ts";
import { SettingRow } from "./parts.tsx";

/** Whole minutes, 1 to 999, as the field takes them; null for anything else. */
const parseMinutes = (text: string): number | null => {
  const trimmed = text.trim();

  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const minutes = Number(trimmed);

  return minutes >= 1 ? minutes : null;
};

/** Saved on blur or ↵ when it is a whole number of minutes; otherwise it keeps the old one. */
const MinutesField = ({
  value,
  disabled,
}: {
  readonly value: number;
  readonly disabled: boolean;
}) => {
  const [draft, setDraft] = useState(String(value));
  const parsed = parseMinutes(draft);

  const save = () => {
    if (parsed !== null && parsed !== value) setSessionPrefs({ longTurnMinutes: parsed });
  };

  return (
    <Input
      id="long-turn-minutes"
      aria-label="Minutes"
      className="h-7 w-14 text-center tabular-nums"
      inputMode="numeric"
      value={draft}
      disabled={disabled}
      aria-invalid={parsed === null}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") save();
      }}
    />
  );
};

export const TurnNotifications = () => {
  const prefs = useSettings((s) => s.sessions);
  const off = !prefs.notifyTurnEnded;

  return (
    <div>
      <SettingRow
        title="Notify when a turn finishes"
        caption={`A ${clientCopy().os} notification once a session is idle with no background tasks left, unless Polaris shows it. Not for constellation workers.`}
        htmlFor="notify-turn-ended"
      >
        <Switch
          id="notify-turn-ended"
          checked={prefs.notifyTurnEnded}
          onCheckedChange={(on) => setSessionPrefs({ notifyTurnEnded: on })}
        />
      </SettingRow>
      <div
        className={cn(
          "px-panel gap-row-x text-label text-text-default -mt-1 flex items-center pb-[calc(var(--spacing-gap)+4px)]",
          off && "opacity-(--opacity-dimmed)"
        )}
      >
        <input
          type="checkbox"
          id="notify-long-turns"
          aria-label={`Only turns longer than ${prefs.longTurnMinutes} minutes`}
          className="size-3.5 shrink-0 accent-current"
          checked={prefs.notifyLongTurnsOnly}
          disabled={off}
          onChange={(event) =>
            setSessionPrefs({ notifyLongTurnsOnly: event.currentTarget.checked })
          }
        />
        <label htmlFor="notify-long-turns">Only turns longer than</label>
        <MinutesField key={prefs.longTurnMinutes} value={prefs.longTurnMinutes} disabled={off} />
        <span>minutes</span>
      </div>
    </div>
  );
};

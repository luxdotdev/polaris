/** Pairing an Extension with one Host (Paper X1): a name and the Grant, read only at first. */
import type { Grant, GrantKind } from "@polaris/protocol";
import { Button, Input } from "@polaris/ui";
import { useState } from "react";
import { DEFAULT_GRANT, GRANT_CHOICES, pairName, toggleGrant } from "../model.ts";

const GrantRow = ({
  id,
  label,
  help,
  checked,
  onToggle,
}: {
  readonly id: string;
  readonly label: string;
  readonly help: string;
  readonly checked: boolean;
  readonly onToggle: () => void;
}) => (
  <div className="flex items-start gap-2.5 py-1.5">
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={onToggle}
      aria-describedby={`${id}-help`}
      className="mt-0.5 size-3.5 shrink-0 accent-current"
    />
    <div className="flex min-w-0 flex-col gap-0.5">
      <label htmlFor={id} className="text-label text-text-strong">
        {label}
      </label>
      <span id={`${id}-help`} className="text-caption text-text-subtle">
        {help}
      </span>
    </div>
  </div>
);

export const PairForm = ({
  hostKey,
  hostLabel,
  onPair,
  onCancel,
}: {
  readonly hostKey: string;
  readonly hostLabel: string;
  readonly onPair: (name: string, grant: Grant) => Promise<void>;
  readonly onCancel: () => void;
}) => {
  const [draft, setDraft] = useState("");
  const [grant, setGrant] = useState<ReadonlyArray<GrantKind>>(DEFAULT_GRANT);
  const [busy, setBusy] = useState(false);
  const name = pairName(draft);

  const submit = () => {
    if (name === null || busy) return;
    setBusy(true);
    void onPair(name, grant).finally(() => setBusy(false));
  };

  return (
    <form
      className="rounded-card border-hairline bg-surface-raised p-panel flex flex-col gap-4 border"
      aria-label={`Pair an extension with ${hostLabel}`}
      data-testid="pair-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h3 className="text-label text-text-strong font-medium">
        Pair an extension with {hostLabel}
      </h3>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`pair-name-${hostKey}`} className="text-caption text-text-subtle">
          Name
        </label>
        <Input
          id={`pair-name-${hostKey}`}
          autoFocus
          value={draft}
          placeholder="Raycast"
          onChange={(event) => setDraft(event.currentTarget.value)}
          className="w-80"
        />
      </div>
      <fieldset className="flex flex-col gap-0.5">
        <legend className="text-caption text-text-subtle pb-1.5">Allow it to</legend>
        {GRANT_CHOICES.map((choice) => (
          <GrantRow
            key={choice.kind}
            id={`grant-${hostKey}-${choice.kind}`}
            label={choice.label}
            help={choice.help}
            checked={grant.includes(choice.kind)}
            onToggle={() => setGrant((g) => toggleGrant(g, choice.kind))}
          />
        ))}
      </fieldset>
      <div className="border-hairline flex items-center gap-2 border-t pt-3">
        <span className="text-caption text-text-faint flex-1">
          You can't change a grant later; revoke and pair again instead.
        </span>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={name === null || busy}>
          Pair
        </Button>
      </div>
    </form>
  );
};

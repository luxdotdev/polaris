/**
 * A Secret Request in the conversation (ADR 0089): the agent's label and reason, a masked
 * single-line field, Save securely and Decline. The value lives only in this field until it is
 * sent, then the field clears. Ideas and copy after pingdotgg/t3code@da8cc59 (MIT); no code.
 */
import type { ApprovalRequest } from "@polaris/protocol";
import { Button, CheckIcon, cn, INPUT_BASE, Kbd, PixelKeyIcon, ShieldIcon } from "@polaris/ui";
import { type FormEvent, useState } from "react";
import { useNow } from "../../../shell/useNow.ts";
import {
  askingForSecret,
  SECRET_FOOTER,
  SECRET_OUTCOME_TEXT,
  type SecretOutcome,
  secretDraft,
  secretPlaceholder,
  secretTimeLeft,
} from "../model/secret.ts";

export interface SecretCardProps {
  readonly request: ApprovalRequest;
  /** "Claude Code", or "The agent" without a known Harness. */
  readonly who: string;
  /** Sends the value; resolves to null once saved, else the words to show. */
  readonly onProvide: (value: string) => Promise<string | null>;
  readonly onDecline: () => void;
}

/** Password managers skip the field and never offer to save it; it isn't a password input. */
const NOT_A_LOGIN = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "",
  "data-form-type": "other",
} as const;

const Countdown = ({ expiresAt }: { readonly expiresAt: string | null | undefined }) => {
  const left = secretTimeLeft(expiresAt, useNow(30_000));

  return left === null ? null : (
    <span className="text-caption text-text-subtle tabular">{left}</span>
  );
};

export const SecretCard = ({ request, who, onProvide, onDecline }: SecretCardProps) => {
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const draft = secretDraft(typed);
  const shownProblem = problem ?? (draft.ok ? null : draft.problem);

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (!draft.ok || saving) return;
    setSaving(true);
    setProblem(null);
    setTyped("");
    void onProvide(draft.value).then((failure) => {
      setSaving(false);
      setProblem(failure);
    });
  };

  return (
    <form
      data-testid="secret-request"
      onSubmit={submit}
      className="rounded-card border-hairline bg-surface-raised flex flex-col overflow-clip border"
    >
      <div className="pixelated border-needs-you/14 flex h-10 shrink-0 items-center gap-2.5 border-b bg-(image:--wash-needs-you) bg-cover bg-center px-3.5">
        <PixelKeyIcon size={14} className="text-needs-you" />
        <span className="text-caption text-text-strong font-medium">{askingForSecret(who)}</span>
        <span className="flex-1" />
        <Countdown expiresAt={request.expiresAt} />
      </div>
      <div className="flex flex-col gap-3 p-3.5">
        <div className="flex flex-col gap-1">
          <p className="text-heading-sm text-text-strong [overflow-wrap:anywhere]">
            {request.title}
          </p>
          {request.detail === null || request.detail === "" ? null : (
            <p className="text-body text-text-subtle [overflow-wrap:anywhere] whitespace-pre-wrap">
              {request.detail}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <input
            type="text"
            aria-label={request.title}
            aria-invalid={shownProblem !== null}
            placeholder={secretPlaceholder(request)}
            value={typed}
            disabled={saving}
            onChange={(event) => {
              setTyped(event.target.value);
              setProblem(null);
            }}
            className={cn(INPUT_BASE, "h-8 px-2.5 font-mono [-webkit-text-security:disc]")}
            {...NOT_A_LOGIN}
          />
          {shownProblem === null ? null : (
            <p role="alert" className="text-caption text-failed">
              {shownProblem}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="submit" variant="primary" disabled={!draft.ok || saving}>
            {saving ? "Saving…" : "Save securely"}
            <Kbd variant="plain">↵</Kbd>
          </Button>
          <span className="flex-1" />
          <Button type="button" variant="ghost" className="px-2.5" onClick={onDecline}>
            Decline
          </Button>
        </div>
      </div>
      <p className="border-hairline text-caption text-text-subtle flex items-center gap-2 border-t px-3.5 py-2.5">
        <ShieldIcon size={14} className="shrink-0" />
        {SECRET_FOOTER}
      </p>
    </form>
  );
};

/** A Secret Request that ended while shown: its label and how it ended. */
export const SettledSecretCard = ({
  request,
  outcome,
}: {
  readonly request: ApprovalRequest;
  readonly outcome: SecretOutcome;
}) => (
  <div
    data-testid="secret-request-settled"
    data-outcome={outcome}
    className="rounded-card border-hairline bg-surface-raised flex items-center gap-2.5 border px-3.5 py-2.5"
  >
    {outcome === "provided" ? (
      <ShieldIcon size={14} className="text-text-subtle shrink-0" />
    ) : (
      <PixelKeyIcon size={14} className="text-text-faint shrink-0" />
    )}
    <span className="text-label text-text-default min-w-0 truncate">{request.title}</span>
    <span className="flex-1" />
    <span className="text-caption text-text-subtle flex shrink-0 items-center gap-1">
      {outcome === "provided" ? <CheckIcon size={12} /> : null}
      {SECRET_OUTCOME_TEXT[outcome]}
    </span>
  </div>
);

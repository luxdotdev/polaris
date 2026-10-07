/**
 * The Trust card (DESIGN.md, Editor: Trust; Paper L2): anchored under the
 * breadcrumbs at the editor's top right while the Daemon asks to run the open
 * checkout's own TypeScript. Esc is Not now; failures stay on the card.
 */
import { Button } from "@polaris/ui";
import { useId, type KeyboardEvent } from "react";
import { useApp } from "../../../shell/hooks.ts";
import { polaris } from "../../bridge.ts";
import { fileKey } from "../model/drafts.ts";
import { changeTrust, decideTrust } from "./decide.ts";
import {
  trustCopy,
  trustFailure,
  type TrustDecision,
  type TrustPhase,
  type TrustStatus,
} from "./model.ts";
import { useTrustAsk } from "./store.ts";

export interface TrustCardProps {
  readonly status: TrustStatus;
  readonly phase: TrustPhase;
  readonly workspace: string;
  readonly host: string;
  readonly onDecide: (action: TrustDecision) => void;
}

export const TrustCard = ({ status, phase, workspace, host, onDecide }: TrustCardProps) => {
  const id = useId();
  const copy = trustCopy(status, workspace, host);
  const busy = phase.kind === "submitting";

  const decide = (action: TrustDecision) => {
    if (!busy) onDecide(action);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    decide("decline");
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      aria-busy={busy}
      data-testid="trust-card"
      data-phase={phase.kind}
      onKeyDown={onKeyDown}
      className="rounded-card border-hairline bg-surface-raised shadow-float animate-in fade-in-0 top-panel p-panel absolute right-5 z-20 flex w-[392px] max-w-[calc(100%-40px)] flex-col gap-[calc(var(--spacing-gap)*1.5)] border duration-160 ease-out"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id={`${id}-title`} className="text-heading-sm text-text-strong">
          {copy.title}
        </h2>
        <p id={`${id}-body`} className="text-body text-text-subtle">
          {copy.body}
        </p>
      </div>
      <p className="text-caption text-text-faint">{copy.caption}</p>
      {phase.kind === "failed" ? (
        <p role="alert" className="text-caption text-text-strong" data-reason={phase.error.reason}>
          {trustFailure(phase.error, host)}
        </p>
      ) : null}
      <div className="gap-gap flex items-center justify-end">
        <Button variant="secondary" aria-disabled={busy} onClick={() => decide("decline")}>
          Not now
        </Button>
        <Button variant="primary" aria-disabled={busy} onClick={() => decide("trust")}>
          {busy && phase.action === "trust" ? "Trusting…" : copy.trust}
        </Button>
      </div>
    </div>
  );
};

// Acceptance drives Trust changes through the renderer, as the palette will (scripts/trustCardSmoke.ts).
window.__polarisTrust = {
  change: (target, action, expectedRevision) => {
    const api = polaris().languages;

    return api === undefined
      ? Promise.reject(new Error("Language tooling is unavailable."))
      : changeTrust(api, target, action, expectedRevision).then(() => undefined);
  },
};

export interface EditorTrustProps {
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly hostLabel: string;
}

/** The card for the open file's checkout, if its Daemon is asking. */
export const EditorTrust = ({ hostKey, workspaceId, path, hostLabel }: EditorTrustProps) => {
  const open = useTrustAsk(fileKey(hostKey, path));

  const workspace = useApp(
    (s) => s.hostModels[hostKey]?.workspaces.get(workspaceId)?.name ?? "this workspace"
  );

  if (open === null) return null;
  const api = polaris().languages;

  return (
    <TrustCard
      key={open.key}
      status={open.ask.status}
      phase={open.ask.phase}
      workspace={workspace}
      host={hostLabel}
      onDecide={(action) => {
        if (api !== undefined) void decideTrust(api, open.key, action);
      }}
    />
  );
};

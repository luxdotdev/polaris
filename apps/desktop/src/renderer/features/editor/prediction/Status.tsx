/**
 * The status bar's tab completion item and its card (DESIGN.md, Tab completion status card):
 * the star and a short label; hover or focus opens the card after 300ms, click or ↵ at once
 * with focus on its first action, as the Session context card does.
 */
import { HoverCard, HoverCardContent, HoverCardTrigger, PixelPolarisIcon } from "@polaris/ui";
import { type FocusEvent, useEffect, useId, useRef, useState } from "react";
import { hostInSentence } from "../../../shell/hostCopy.ts";
import { useApp, useCommands } from "../../../shell/hooks.ts";
import { polaris } from "../../bridge.ts";
import { DEFAULT_PREDICTION_PREFERENCES } from "../../../../shared/predictionPlacement.ts";
import { inSentence } from "../../settings/editor/placementRows.ts";
import { fileKey } from "../model/drafts.ts";
import { useTrustStatus } from "../trust/store.ts";
import { runCardAction } from "./card/actions.ts";
import { CompletionCard, type Outcome } from "./card/CompletionCard.tsx";
import { useMemoryLine, useServerReport } from "./card/hooks.ts";
import { gb } from "./card/managed.ts";
import { completionCard, type CardAction, type CardActionId } from "./card/model.ts";
import { setHostPreferences, usePrediction, watchManaged } from "./store.ts";
import { clientCopy } from "../../../../shared/clientCopy.ts";

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export interface PredictionStatusProps {
  readonly hostKey: string;
  /** The open file, for its Workspace's trust. */
  readonly path?: string | undefined;
}

export const PredictionStatus = ({ hostKey, path }: PredictionStatusProps) => {
  const host = useApp((state) => state.hosts.find((item) => item.key === hostKey));
  const state = usePrediction((value) => value);
  const trust = useTrustStatus(path === undefined ? "" : fileKey(hostKey, path));
  const commands = useCommands();
  const api = polaris();
  const titleId = useId();
  const content = useRef<HTMLDivElement>(null);
  const acknowledged = useRef(false);
  const [open, setOpen] = useState(false);
  // Click or ↵ opens it at once and moves focus in; hover leaves focus in the editor.
  const [focusIn, setFocusIn] = useState(false);
  const [running, setRunning] = useState<{ readonly id: CardActionId } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [revision, setRevision] = useState(0);
  const inspection = state.inspections[hostKey];

  const offer =
    host?.status.state === "connected" && !state.configured && inspection?.offer === true;

  useEffect(() => {
    if (!offer || acknowledged.current) return;
    acknowledged.current = true;
    void api.request("prediction.discoveryShown", {});
  }, [api, offer]);

  // The portal mounts the content a frame after `open`, so focus waits for it.
  useEffect(() => {
    if (!open || !focusIn) return;

    const frame = requestAnimationFrame(() =>
      content.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus()
    );

    return () => cancelAnimationFrame(frame);
  }, [open, focusIn]);

  const clientName = inSentence(inspection?.clientLabel ?? clientCopy().localHost);

  const input = {
    connection: host?.status.state,
    hostName: hostInSentence(host),
    hostKey,
    enabled: state.enabled,
    offer,
    preferences: state.preferences[hostKey] ?? DEFAULT_PREDICTION_PREFERENCES,
    inspection,
    result: state.enabled ? state.results[hostKey] : undefined,
    failure: state.failures[hostKey],
    trusted: trust === null ? null : trust.trust.trusted,
  };

  const preview = completionCard({ ...input, server: null, memory: null });
  const target = preview.target;
  const managed = preview.managed;
  const managedSide = managed?.side;
  const busy = preview.kind === "downloading" || preview.kind === "loading";

  // The managed server's changes are followed while the card is open or a download or load runs.
  useEffect(() => {
    if (managedSide === undefined || (!open && !busy)) return;

    return watchManaged(api, hostKey, managedSide);
  }, [api, hostKey, managedSide, open, busy]);

  const ownsTarget = managed !== null && managed.status.endpoint?.url === target?.endpoint.url;
  const server = useServerReport(api, hostKey, target, open && !ownsTarget, revision);
  const probed = useMemoryLine(api, open, target?.side === "client" && !ownsTarget, clientName);

  const memory =
    ownsTarget && managed.status.memoryBytes !== null
      ? `Polaris model server on ${target?.machine} · ${gb(managed.status.memoryBytes)} of memory, counted apart from Polaris`
      : probed;

  const view = completionCard({ ...input, server: server.report, memory });

  const run = (action: CardAction) => {
    setRunning({ id: action.id });
    setOutcome(null);
    void runCardAction(action, {
      api,
      hostKey,
      view,
      remember: server.remember,
      openSettings: () => {
        setOpen(false);
        commands.runAny("settings.editor");
      },
    })
      .then((text) => {
        if (action.id === "check-again") setRevision((n) => n + 1);
        setOutcome(text === null ? null : { text, failed: false });
      })
      .catch((cause: unknown) => setOutcome({ text: message(cause), failed: true }))
      .finally(() => setRunning(null));
  };

  const chooseModel = (model: string | null) => {
    setOutcome(null);
    void setHostPreferences(api, hostKey, { model, format: null }).catch((cause: unknown) =>
      setOutcome({ text: message(cause), failed: true })
    );
  };

  // Focus moving into the card isn't leaving it; Radix closes a hover card on the trigger's blur.
  const within = (event: FocusEvent) =>
    event.relatedTarget instanceof Node && content.current?.contains(event.relatedTarget) === true;

  return (
    <HoverCard
      open={open}
      onOpenChange={(next) => {
        if (!next) setFocusIn(false);
        setOpen(next);
      }}
    >
      <HoverCardTrigger asChild>
        <button
          type="button"
          data-testid="prediction-status"
          data-kind={view.kind}
          aria-label={`Tab completion: ${view.title}`}
          aria-expanded={open}
          onBlur={(event) => {
            if (within(event)) event.preventDefault();
          }}
          onClick={() => {
            setFocusIn(true);
            setOpen(true);
          }}
          className="text-caption text-text-subtle hover:text-text-default focus-visible:outline-starlight flex min-w-0 cursor-default items-center gap-1.5 truncate rounded-sm focus-visible:outline-2"
        >
          <PixelPolarisIcon
            aria-hidden
            size={12}
            className={view.kind === "serving" ? "shrink-0" : "shrink-0 opacity-50"}
          />
          <span className="truncate">{view.label}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="end"
        ref={content}
        tabIndex={-1}
        role="dialog"
        aria-labelledby={titleId}
        data-testid="completion-card"
        data-kind={view.kind}
        onBlur={(event) => {
          if (!within(event) && running === null) setOpen(false);
        }}
        className="rounded-row flex w-[360px] flex-col overflow-hidden p-0 outline-none"
      >
        <CompletionCard
          view={view}
          running={running}
          outcome={outcome}
          titleId={titleId}
          onRun={run}
          onModel={chooseModel}
        />
      </HoverCardContent>
    </HoverCard>
  );
};

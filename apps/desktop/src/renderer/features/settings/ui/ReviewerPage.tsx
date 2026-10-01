/**
 * Settings → Reviewer (Paper S7; ENG-222): the Reviewer every Host runs (Harness, Model,
 * effort, or automatic), whether it can run on each Host, its Workspace overrides, when it
 * runs, and what it checks against. Settings live on each Host; changes go to all of them.
 */
import { Button, PixelPolarisIcon, Tile } from "@polaris/ui";
import { useState } from "react";
import { slots } from "../../../app/slots.tsx";
import { useApp } from "../../../shell/hooks.ts";
import { harnessGroups } from "../model/harnesses.ts";
import {
  AUTO_CAPTION,
  type Choice,
  choiceLabel,
  type HostReviewer,
  overridesOf,
  readySummary,
  type ReviewerHostRow,
  reviewerHostRows,
  reviewerTitle,
  type Settings,
  sharedDefault,
  sharedPolicy,
  sharedWalkthrough,
  SOL,
  withDefault,
  withOverride,
  withPolicy,
  withWalkthrough,
} from "../model/reviewer.ts";
import { sectionInfo } from "../model/sections.ts";
import { Action, GLYPHS } from "./harnessRow.tsx";
import { useHostProbes } from "./hostProbes.ts";
import { workspaceLabel } from "../model/workspaces.ts";
import { Column, PageHeader } from "./parts.tsx";
import { ReviewerChoice, useModelName } from "./ReviewerChoice.tsx";
import { ChecksAgainst, WhenItRuns } from "./ReviewerRuns.tsx";
import { useReviewers } from "./useReviewers.ts";
import {
  OverrideStrip,
  overrideCount,
  useWorkspaceOptions,
  WorkspaceOverrides,
} from "./WorkspaceOverrides.tsx";

const HostLine = ({
  row,
  signingIn,
  onSignIn,
  onDone,
}: {
  readonly row: ReviewerHostRow;
  readonly signingIn: boolean;
  readonly onSignIn: () => void;
  readonly onDone: () => void;
}) => {
  const action = row.row?.action ?? null;

  return (
    <div className="flex flex-col" data-testid="reviewer-host">
      <div className="px-panel flex min-h-[calc(var(--spacing-row)+8px)] items-center gap-3 py-[calc(var(--spacing-gap)-2px)]">
        <span className="text-body text-text-default w-[156px] shrink-0 truncate font-medium">
          {row.hostLabel}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body text-text-default flex items-center gap-1.5">
            <span className="text-text-subtle flex w-3.5 shrink-0 justify-center">
              {GLYPHS[row.row?.glyph ?? "unknown"]}
            </span>
            <span className="truncate">{row.text}</span>
          </span>
          {row.caption === null ? null : (
            <span className="text-caption text-text-subtle truncate">{row.caption}</span>
          )}
        </span>
        {action === null || row.row?.ready ? (
          <span className="text-caption text-text-subtle shrink-0">{row.aside}</span>
        ) : (
          <Action action={action} onSignIn={onSignIn} />
        )}
      </div>
      {signingIn && action?.kind === "sign-in" ? (
        <slots.HarnessTerminal
          hostKey={row.hostKey}
          argv={action.argv}
          onExit={onDone}
          onClose={onDone}
        />
      ) : null}
    </div>
  );
};

/** A Host where `harness` is ready, to list its Models. */
const useModelHost = () => {
  const { hosts } = useHostProbes();
  const groups = harnessGroups(hosts);

  return (harness: string) =>
    groups.find((g) => g.kind === harness)?.rows.find((r) => r.ready)?.hostKey ?? null;
};

/** "Walkthrough": its own Harness, Model and Effort, or the reviewer's (Reset). */
const WalkthroughModel = ({
  value,
  fallback,
  onChange,
  modelHost,
}: {
  readonly value: Choice | null;
  readonly fallback: Choice;
  readonly onChange: (choice: Choice | null) => void;
  readonly modelHost: (harness: string) => string | null;
}) => (
  <div className="flex items-center gap-3" data-testid="walkthrough-model">
    <span className="text-caption text-text-subtle w-20 shrink-0">Walkthrough</span>
    <div className="min-w-0 flex-1">
      <ReviewerChoice
        value={value ?? fallback}
        onChange={onChange}
        modelHost={modelHost}
        allowAuto={false}
      />
    </div>
    {value === null ? (
      <span className="text-caption text-text-subtle shrink-0">Same as the reviewer</span>
    ) : (
      <Button
        variant="ghost"
        size="xs"
        className="text-text-default"
        onClick={() => onChange(null)}
      >
        Reset
      </Button>
    )}
  </div>
);

const ReviewerCard = ({
  reviewers,
  saveAll,
  onWalkthrough,
}: {
  readonly reviewers: Readonly<Record<string, HostReviewer>>;
  readonly saveAll: (choice: Choice | null) => void;
  readonly onWalkthrough: (choice: Choice | null) => void;
}) => {
  const { hosts, refresh } = useHostProbes();
  const models = useApp((s) => s.hostModels);
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const modelHost = useModelHost();
  const { choice, differs } = sharedDefault(Object.values(reviewers));
  const walkthrough = sharedWalkthrough(Object.values(reviewers));
  const modelName = useModelName(modelHost(choice?.harness ?? ""), choice?.harness ?? "");

  const checkouts = Object.fromEntries(
    Object.entries(models).map(([key, m]) => [key, m.reviewCheckouts.size] as const)
  );

  const rows = reviewerHostRows(hosts, reviewers, checkouts);

  return (
    <section
      aria-label="Reviewer"
      data-testid="reviewer-card"
      className="rounded-card border-hairline divide-hairline flex flex-col divide-y overflow-clip border bg-[light-dark(var(--color-surface-raised),transparent)]"
    >
      <div className="px-panel flex items-center gap-3 py-[calc(var(--spacing-panel)-2px)]">
        <Tile hue="starlight" size={32}>
          <PixelPolarisIcon size={16} className="text-starlight" />
        </Tile>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className="text-heading-sm text-text-strong truncate font-medium"
            data-testid="reviewer-title"
          >
            {reviewerTitle(choice, modelName)}
          </span>
          <span className="text-caption text-text-subtle text-pretty">
            {choice === null
              ? AUTO_CAPTION
              : "For every change, whichever harness made it · read-only"}
          </span>
        </span>
        <span className="text-caption text-text-subtle shrink-0">{readySummary(rows)}</span>
      </div>
      <div className="px-panel flex flex-col gap-2 py-[calc(var(--spacing-gap)+4px)]">
        <div className="flex items-center gap-3">
          <span className="text-caption text-text-subtle w-20 shrink-0">Reviewer</span>
          <div className="min-w-0 flex-1">
            <ReviewerChoice value={choice} onChange={saveAll} modelHost={modelHost} allowAuto />
          </div>
        </div>
        {walkthrough.enabled && (
          <WalkthroughModel
            value={walkthrough.choice}
            fallback={choice ?? SOL}
            onChange={onWalkthrough}
            modelHost={modelHost}
          />
        )}
        {differs ? (
          <span className="text-caption text-text-subtle">
            Your hosts have different reviewers; a change here applies to all of them.
          </span>
        ) : null}
      </div>
      <div className="divide-hairline flex flex-col divide-y">
        {rows.map((row) => (
          <HostLine
            key={row.hostKey}
            row={row}
            signingIn={signingIn === row.hostKey}
            onSignIn={() => setSigningIn(row.hostKey)}
            onDone={() => {
              setSigningIn(null);
              refresh(row.hostKey);
            }}
          />
        ))}
      </div>
    </section>
  );
};

const Overrides = ({
  reviewers,
  save,
}: {
  readonly reviewers: Readonly<Record<string, HostReviewer>>;
  readonly save: (hostKey: string, settings: Settings) => void;
}) => {
  const options = useWorkspaceOptions().filter((o) => {
    const reviewer = reviewers[o.hostKey];

    return o.isGitRepo && reviewer?.kind === "loaded";
  });

  const overrides = overridesOf(reviewers);
  const modelHost = useModelHost();
  const { choice } = sharedDefault(Object.values(reviewers));

  const set = (key: string, next: Choice | null) => {
    const option = options.find((o) => o.key === key);

    const [hostKey = "", workspaceId = ""] =
      option === undefined ? key.split("/") : [option.hostKey, option.workspaceId];

    const reviewer = reviewers[hostKey];

    if (reviewer?.kind === "loaded")
      save(hostKey, withOverride(reviewer.settings, workspaceId, next));
  };

  const keys = Object.keys(overrides).toSorted();
  const [first] = keys;
  const firstChoice = first === undefined ? undefined : overrides[first];

  const detail =
    first === undefined || firstChoice === undefined
      ? null
      : `${workspaceLabel(options, first)} reviews with ${choiceLabel(firstChoice)}`;

  return (
    <OverrideStrip summary={overrideCount(keys.length, "the reviewer")} detail={detail}>
      <WorkspaceOverrides
        label="Workspace reviewers"
        keys={keys}
        options={options}
        addLabel="A workspace can use its own reviewer, kept on its host."
        onAdd={(key) => set(key, choice ?? SOL)}
        onRemove={(key) => set(key, null)}
        control={(key) => (
          <ReviewerChoice
            value={overrides[key] ?? null}
            onChange={(next) => set(key, next)}
            modelHost={modelHost}
            allowAuto={false}
          />
        )}
      />
    </OverrideStrip>
  );
};

export const ReviewerPage = () => {
  const info = sectionInfo("reviewer");
  const { reviewers, save } = useReviewers();

  /** Host-wide settings go to every Host that has a Reviewer. */
  const saveAll = (change: (settings: Settings) => Settings) => {
    for (const [hostKey, reviewer] of Object.entries(reviewers)) {
      if (reviewer.kind === "loaded") save(hostKey, change(reviewer.settings));
    }
  };

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      <ReviewerCard
        reviewers={reviewers}
        saveAll={(choice) => saveAll((settings) => withDefault(settings, choice))}
        onWalkthrough={(choice) => saveAll((settings) => withWalkthrough(settings, { choice }))}
      />
      <Overrides reviewers={reviewers} save={save} />
      <WhenItRuns
        policy={sharedPolicy(Object.values(reviewers))}
        walkthrough={sharedWalkthrough(Object.values(reviewers)).enabled}
        onWalkthrough={(enabled) => saveAll((settings) => withWalkthrough(settings, { enabled }))}
        onChange={(patch) => saveAll((settings) => withPolicy(settings, patch))}
      />
      <ChecksAgainst />
    </Column>
  );
};

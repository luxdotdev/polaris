/**
 * Settings → Reviewer (Paper S7; ENG-222): the Reviewer every Host runs (Harness, Model,
 * effort, or automatic), whether it can run on each Host, and per-Workspace overrides.
 * The settings live on each Host; the default is written to all of them.
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
  sameChoice,
  type Settings,
  sharedDefault,
  SOL,
  withDefault,
  withOverride,
} from "../model/reviewer.ts";
import { sectionInfo } from "../model/sections.ts";
import { Action, GLYPHS } from "./harnessRow.tsx";
import { useHostProbes } from "./hostProbes.ts";
import { Column, FooterStrip, Heading, PageHeader } from "./parts.tsx";
import { ReviewerChoice, useModelName } from "./ReviewerChoice.tsx";
import { useReviewers } from "./useReviewers.ts";
import { useWorkspaceOptions, WorkspaceOverrides } from "./WorkspaceOverrides.tsx";

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
      <div className="px-panel flex min-h-10 items-center gap-3 py-1.5">
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
          <span className="text-caption text-text-faint shrink-0">{row.aside}</span>
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

const ReviewerCard = ({
  reviewers,
  saveAll,
}: {
  readonly reviewers: Readonly<Record<string, HostReviewer>>;
  readonly saveAll: (choice: Choice | null) => void;
}) => {
  const { hosts, refresh } = useHostProbes();
  const models = useApp((s) => s.hostModels);
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const modelHost = useModelHost();
  const { choice, differs } = sharedDefault(Object.values(reviewers));
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
      <div className="px-panel flex items-center gap-3 py-3.5">
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
          <span className="text-caption text-text-subtle truncate">
            {choice === null
              ? AUTO_CAPTION
              : "For every change, whichever harness made it · read-only"}
          </span>
        </span>
        <span className="text-caption text-text-subtle shrink-0">{readySummary(rows)}</span>
      </div>
      <div className="px-panel flex flex-col gap-2 py-3">
        <ReviewerChoice value={choice} onChange={saveAll} modelHost={modelHost} allowAuto />
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
      {sameChoice(choice, SOL) ? null : (
        <FooterStrip>
          <span className="text-caption text-text-subtle flex-1">
            Sets the same reviewer on every host.
          </span>
          <Button size="xs" onClick={() => saveAll(SOL)} data-testid="reviewer-use-sol">
            Use {choiceLabel(SOL)}
          </Button>
        </FooterStrip>
      )}
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

  return (
    <section aria-label="Workspace overrides" className="flex flex-col gap-3">
      <Heading>Workspace overrides</Heading>
      <p className="text-body text-text-subtle -mt-1.5">
        A workspace can use its own reviewer, kept on the host it lives on.
      </p>
      <WorkspaceOverrides
        label="Workspace reviewers"
        keys={Object.keys(overrides).toSorted()}
        options={options}
        addLabel="Choose a workspace to give it its own reviewer."
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
    </section>
  );
};

export const ReviewerPage = () => {
  const info = sectionInfo("reviewer");
  const { reviewers, save } = useReviewers();

  const saveAll = (choice: Choice | null) => {
    for (const [hostKey, reviewer] of Object.entries(reviewers)) {
      if (reviewer.kind === "loaded") save(hostKey, withDefault(reviewer.settings, choice));
    }
  };

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      <ReviewerCard reviewers={reviewers} saveAll={saveAll} />
      <Overrides reviewers={reviewers} save={save} />
    </Column>
  );
};

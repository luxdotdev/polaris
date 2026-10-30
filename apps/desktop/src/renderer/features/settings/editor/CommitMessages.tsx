/**
 * SR-02's Commit messages card: what a draft looks like, from the workspace's last real commit
 * or a static example, and who drafts it (the Harness and Model chips).
 */
import { Kicker, SettingsCard, SettingsRow, SettingsWell } from "@polaris/ui";
import type { ReactNode } from "react";

export interface CommitPreview {
  readonly subject: string;
  readonly body: string;
}

/** Shown while the workspace has no commit to read. */
export const EXAMPLE_COMMIT: CommitPreview = {
  subject: "fix(daemon): a cancel reaches queued requests",
  body: "Queued requests now see the cancel before they start, so a stopped turn never runs late work.",
};

/** The preview's message and its kicker: the real commit when there is one, else the example. */
export const commitPreview = (lastCommit: CommitPreview | null) =>
  lastCommit === null
    ? { kicker: "A draft looks like", message: EXAMPLE_COMMIT }
    : { kicker: "Like your last commit", message: lastCommit };

export const CommitMessagesCard = ({
  lastCommit,
  chooser,
}: {
  /** The workspace's last commit; null until git.log lands (ENG-624), so the example shows. */
  readonly lastCommit: CommitPreview | null;
  /** The Harness and Model chips (CommitMessagesChoice). */
  readonly chooser: ReactNode;
}) => {
  const preview = commitPreview(lastCommit);

  return (
    <SettingsCard
      title="Commit messages"
      aside="Drafted from staged changes"
      status="A small model keeps it quick"
      className="h-full"
    >
      <SettingsWell className="flex-1">
        <div
          data-testid="commit-preview"
          className="px-panel flex flex-1 flex-col gap-1.5 py-[calc(var(--spacing-panel)-2px)]"
        >
          <Kicker className="text-text-subtle">{preview.kicker}</Kicker>
          <p className="text-text-default font-mono text-[12px] leading-[18px]">
            {preview.message.subject}
          </p>
          {preview.message.body === "" ? null : (
            <p className="text-text-subtle line-clamp-3 font-mono text-[12px] leading-[18px]">
              {preview.message.body}
            </p>
          )}
        </div>
        <SettingsRow title="Drafted by">{chooser}</SettingsRow>
      </SettingsWell>
    </SettingsCard>
  );
};

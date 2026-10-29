/**
 * Settings → Sessions (DESIGN.md, Settings): where new sessions work, what a new worktree's
 * branch is called, Output on a Turn's first edit, Needs You and Turn notifications, the Working
 * strip's verbs, where accepted work is committed, Archive, and removing hidden workspaces.
 * Each Harness's Model, effort and permissions stay in Settings → Harnesses.
 */
import { clientCopy } from "../../../../shared/clientCopy.ts";
import { Button, Input, Switch } from "@polaris/ui";
import { useState } from "react";
import { isBranchPrefix } from "../../../../shared/sessionPrefs.ts";
import { useShellActions } from "../../../shell/hooks.ts";
import { sectionInfo } from "../model/sections.ts";
import { setSessionPrefs, useSettings } from "../store.ts";
import { Column, Group, PageHeader, SettingRow } from "./parts.tsx";
import { AcceptBranch } from "./AcceptBranch.tsx";
import { AutoArchiveSettings } from "./AutoArchive.tsx";
import { HiddenWorkspaces } from "./HiddenWorkspaces.tsx";
import { WorktreeSetupSettings } from "./WorktreeSetup.tsx";
import { TurnNotifications } from "./TurnNotifications.tsx";
import { WorkingVerbs } from "./WorkingVerbs.tsx";

/** Saved on blur or ↵ when git would take it; otherwise the field says why and keeps the old one. */
const BranchPrefixField = ({ value }: { readonly value: string }) => {
  const [draft, setDraft] = useState(value);
  const valid = isBranchPrefix(draft.trim());

  const save = () => {
    const next = draft.trim();

    if (isBranchPrefix(next) && next !== value) setSessionPrefs({ branchPrefix: next });
  };

  return (
    <Input
      id="branch-prefix"
      className="text-code-inline w-[160px] font-mono"
      value={draft}
      placeholder="none"
      aria-invalid={!valid}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") save();
      }}
    />
  );
};

const example = (prefix: string) => `${prefix}fix-the-login-form-3f9a`;

export const SessionsPage = () => {
  const prefs = useSettings((s) => s.sessions);
  const { openSettings } = useShellActions();
  const info = sectionInfo("sessions");

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      <Group label="New sessions">
        <SettingRow
          title="Start on a new worktree"
          caption="Otherwise they work in the workspace directory. Each session can still choose."
          htmlFor="new-worktree"
        >
          <Switch
            id="new-worktree"
            checked={prefs.newWorktree}
            onCheckedChange={(on) => setSessionPrefs({ newWorktree: on })}
          />
        </SettingRow>
        <SettingRow
          title="Branch prefix"
          caption={`A new worktree's branch, named from the prompt: ${example(prefs.branchPrefix)}`}
          htmlFor="branch-prefix"
        >
          <BranchPrefixField key={prefs.branchPrefix} value={prefs.branchPrefix} />
        </SettingRow>
      </Group>
      <Group label="While sessions run">
        <SettingRow
          title="Open output on a turn's first edit"
          caption="Once per turn; closing it keeps it closed until the next turn"
          htmlFor="open-output"
        >
          <Switch
            id="open-output"
            checked={prefs.openOutputOnEdit}
            onCheckedChange={(on) => setSessionPrefs({ openOutputOnEdit: on })}
          />
        </SettingRow>
        <SettingRow
          title="Notify when a session needs you"
          caption={`A ${clientCopy().os} notification, unless Polaris shows that session. The star still counts.`}
          htmlFor="notify-needs-you"
        >
          <Switch
            id="notify-needs-you"
            checked={prefs.notifyNeedsYou}
            onCheckedChange={(on) => setSessionPrefs({ notifyNeedsYou: on })}
          />
        </SettingRow>
        <SettingRow
          title="Notify when a constellation needs you"
          caption="A question to you or a claim the lead hands up, even when no agent calls notify. Once per question; your phone has its own switch."
          htmlFor="notify-constellations"
        >
          <Switch
            id="notify-constellations"
            checked={prefs.notifyConstellations}
            onCheckedChange={(on) => setSessionPrefs({ notifyConstellations: on })}
          />
        </SettingRow>
        <SettingRow
          title="Quiet my phone while I'm at this computer"
          caption="Hosts hold your linked phone's notifications while you use this computer, and send what still needs you once you step away or lock the screen."
          htmlFor="quiet-phone"
        >
          <Switch
            id="quiet-phone"
            checked={prefs.quietPhoneWhilePresent}
            onCheckedChange={(on) => setSessionPrefs({ quietPhoneWhilePresent: on })}
          />
        </SettingRow>
        <TurnNotifications />
        <SettingRow
          title="Notify when your review is requested"
          caption={`A ${clientCopy().os} notification per new request on GitHub. Reviews in needs you still lists them.`}
          htmlFor="notify-review-requests"
        >
          <Switch
            id="notify-review-requests"
            checked={prefs.notifyReviewRequests}
            onCheckedChange={(on) => setSessionPrefs({ notifyReviewRequests: on })}
          />
        </SettingRow>
      </Group>
      <WorktreeSetupSettings />
      <WorkingVerbs />
      <AcceptBranch />
      <Group label="Archive">
        <AutoArchiveSettings />
        <SettingRow
          title="Delete merged branches on archive"
          caption="Archive removes a session's worktree. Unmerged branches are never deleted."
          htmlFor="delete-merged"
        >
          <Switch
            id="delete-merged"
            checked={prefs.deleteMergedBranch}
            onCheckedChange={(on) => setSessionPrefs({ deleteMergedBranch: on })}
          />
        </SettingRow>
      </Group>
      <HiddenWorkspaces />
      <p className="text-caption text-text-subtle flex items-center gap-1">
        Model, effort and permissions start per harness.
        <Button variant="ghost" size="xs" onClick={() => openSettings("harnesses")}>
          Settings → Harnesses
        </Button>
      </p>
    </Column>
  );
};

/**
 * The new agent session sheet's content (Paper M6): the typed prompt first, then where it runs,
 * the Harness and Model, Plan first, New worktree, the route line and one Start.
 */
import { type SessionId, type Workspace, WorkspaceId } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { type ReactNode, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NewSessionApi } from "./api.ts";
import { type Draft, type DraftStore, useDraft } from "./draft.ts";
import { modelLabel } from "./harness.ts";
import {
  branchFromPrompt,
  defaultTarget,
  failureText,
  hasPlanMode,
  lastUsedTarget,
  newSessionId,
  planCaption,
  routeLine,
  type SheetHost,
  startCommand,
  type Target,
  worktreeCaption,
} from "./model.ts";
import { HarnessChip, PickerRow, SwitchRow, styles as rowStyles } from "./parts.tsx";
import { HarnessPicker, WorkspacePicker } from "./pickers.tsx";
import { type HarnessChoice, useHarnessChoice } from "./useHarnessChoice.ts";

export interface NewSessionFormProps {
  readonly hosts: ReadonlyArray<SheetHost>;
  readonly api: NewSessionApi;
  readonly workspaceId?: string;
  readonly onClose: () => void;
  readonly onStarted?: (hostId: string, sessionId: string) => void;
  readonly draftStore?: DraftStore;
}

type Pane = "form" | "workspace" | "harness";

const TITLES: Readonly<Record<Pane, string>> = {
  form: "New agent session",
  workspace: "Workspace",
  harness: "Harness",
};

/** The Harness row's sentence while nothing can start; null once one can. */
const harnessBlocker = (choice: HarnessChoice): string | null => {
  if (choice.load.kind === "failed") return `Couldn't check harnesses: ${choice.load.message}`;

  if (choice.load.kind === "loading") return "Checking harnesses…";

  return choice.harness === null ? "No harness is ready on this host" : null;
};

/** Why Start is off ("" when the prompt is only empty); null when it can start. */
const startBlocker = (
  host: SheetHost | null,
  prompt: string,
  choice: HarnessChoice
): string | null => {
  if (host === null) return "Add a workspace on the Mac first";

  if (!host.connected) return `${host.hostName} isn't connected`;

  return harnessBlocker(choice) ?? (prompt.trim() === "" ? "" : null);
};

const Header = ({ pane, onLeave }: { readonly pane: Pane; readonly onLeave: () => void }) => (
  <View style={styles.header}>
    <Pressable onPress={onLeave} accessibilityRole="button" hitSlop={8}>
      <Text style={styles.cancel}>{pane === "form" ? "Cancel" : "Back"}</Text>
    </Pressable>
    <Text style={styles.headerTitle}>{TITLES[pane]}</Text>
    <Text style={[styles.cancel, styles.hidden]}>Cancel</Text>
  </View>
);

const Prompt = ({ draft }: { readonly draft: Draft }) => (
  <View style={styles.prompt}>
    <TextInput
      style={styles.promptInput}
      value={draft.text}
      onChangeText={draft.setText}
      placeholder="What should happen next?"
      placeholderTextColor={midnight.textFaint}
      multiline
      autoFocus
      selectionColor={midnight.textSubtle}
      accessibilityLabel="Prompt"
    />
    <View style={styles.promptBar}>
      <Text style={styles.draft}>{draft.status === "saved" ? "Draft saved" : ""}</Text>
    </View>
  </View>
);

const WorkspaceValue = ({
  host,
  workspace,
  lastUsed,
}: {
  readonly host: SheetHost | null;
  readonly workspace: Workspace | null;
  readonly lastUsed: boolean;
}) =>
  workspace === null || host === null ? (
    <Text style={rowStyles.caption}>No workspace yet</Text>
  ) : (
    <>
      <Text style={rowStyles.value} numberOfLines={1}>
        {workspace.name}
      </Text>
      <Text style={rowStyles.caption} numberOfLines={1}>
        {lastUsed ? `${host.hostName} · last used` : host.hostName}
      </Text>
    </>
  );

const HarnessValue = ({
  choice,
  onOpen,
}: {
  readonly choice: HarnessChoice;
  readonly onOpen: () => void;
}) =>
  choice.harness === null ? (
    <Text style={rowStyles.caption}>{harnessBlocker(choice)}</Text>
  ) : (
    <HarnessChip
      harness={choice.harness}
      model={modelLabel(choice.harness, choice.models, choice.model)}
      onPress={onOpen}
    />
  );

const StartFooter = ({
  host,
  error,
  why,
  busy,
  onStart,
}: {
  readonly host: SheetHost | null;
  readonly error: string | null;
  readonly why: string | null;
  readonly busy: boolean;
  readonly onStart: () => void;
}) => {
  const off = why !== null || busy;

  return (
    <View style={styles.footer}>
      {error === null ? null : <Text style={styles.error}>{error}</Text>}
      {host === null ? null : <Text style={styles.route}>{routeLine(host)}</Text>}
      <Pressable
        style={[styles.start, off ? styles.startOff : null]}
        onPress={onStart}
        disabled={off}
        accessibilityRole="button"
        accessibilityState={{ disabled: off }}
        accessibilityHint={why === null || why === "" ? undefined : why}
      >
        {busy ? (
          <ActivityIndicator color={midnight.bg} />
        ) : (
          <Text style={styles.startLabel}>Start</Text>
        )}
      </Pressable>
    </View>
  );
};

const Sheet = ({ children }: { readonly children: ReactNode }) => (
  <View style={styles.sheet}>{children}</View>
);

export const NewSessionForm = ({
  hosts,
  api,
  workspaceId,
  onClose,
  onStarted,
  draftStore,
}: NewSessionFormProps) => {
  const [picked, setPicked] = useState<Target | null>(null);
  const target = picked ?? defaultTarget(hosts, workspaceId);
  const host = hosts.find((h) => h.hostId === target?.hostId) ?? null;
  const workspace = host?.workspaces.find((w) => w.id === target?.workspaceId) ?? null;
  const last = lastUsedTarget(hosts);
  const draft = useDraft(draftStore);
  const choice = useHarnessChoice(api, host);
  const [planFirst, setPlanFirst] = useState(true);
  const [newWorktree, setNewWorktree] = useState(false);
  // Chosen up front so the branch the caption shows is the one the session gets.
  const [sessionId] = useState<SessionId>(newSessionId);
  const [pane, setPane] = useState<Pane>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const why = startBlocker(host, draft.text, choice);
  const planMode = host !== null && hasPlanMode(host);
  const header = <Header pane={pane} onLeave={pane === "form" ? onClose : () => setPane("form")} />;

  const start = async () => {
    if (why !== null || target === null || choice.harness === null) return;
    setBusy(true);
    setError(null);

    try {
      await api.dispatch(
        target.hostId,
        startCommand({
          sessionId,
          workspaceId: WorkspaceId.make(target.workspaceId),
          harness: choice.harness,
          model: choice.model?.id ?? null,
          prompt: draft.text,
          newWorktree,
        })
      );
      await draft.clear();
      onStarted?.(target.hostId, sessionId);
      onClose();
    } catch (failure) {
      setError(`Couldn't start the session: ${failureText(failure)}`);
      setBusy(false);
    }
  };

  if (pane === "workspace")
    return (
      <Sheet>
        {header}
        <WorkspacePicker
          hosts={hosts}
          target={target}
          onPick={(next) => {
            setPicked(next);
            setPane("form");
          }}
        />
      </Sheet>
    );

  if (pane === "harness" && choice.load.kind === "loaded")
    return (
      <Sheet>
        {header}
        <HarnessPicker
          options={choice.load.options}
          harness={choice.harness}
          models={choice.models}
          model={choice.model}
          onHarness={choice.setHarness}
          onModel={(model) => {
            choice.setModel(model);
            setPane("form");
          }}
        />
      </Sheet>
    );

  return (
    <Sheet>
      {header}
      <Prompt draft={draft} />
      <PickerRow label="Workspace" onPress={() => setPane("workspace")}>
        <WorkspaceValue
          host={host}
          workspace={workspace}
          lastUsed={
            last !== null && last.workspaceId === workspace?.id && last.hostId === host?.hostId
          }
        />
      </PickerRow>
      <PickerRow label="Harness">
        <HarnessValue choice={choice} onOpen={() => setPane("harness")} />
      </PickerRow>
      {host === null ? null : (
        <SwitchRow
          title="Plan first"
          caption={planCaption(host)}
          value={planFirst || !planMode}
          onValueChange={setPlanFirst}
          disabled={!planMode}
        />
      )}
      {workspace === null ? null : (
        <SwitchRow
          title="New worktree"
          caption={worktreeCaption(
            newWorktree,
            workspace,
            host?.homeDir ?? null,
            branchFromPrompt(draft.text, sessionId)
          )}
          value={newWorktree}
          onValueChange={setNewWorktree}
          disabled={!workspace.isGitRepo}
        />
      )}
      <View style={styles.spacer} />
      <StartFooter host={host} error={error} why={why} busy={busy} onStart={() => void start()} />
    </Sheet>
  );
};

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: midnight.surfaceSunken,
    paddingHorizontal: 20,
    paddingBottom: 34,
    paddingTop: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 44,
  },
  cancel: { ...mobileType.body, color: midnight.textSubtle },
  hidden: { opacity: 0 },
  headerTitle: { ...mobileType.title, color: midnight.textStrong },
  prompt: {
    gap: 14,
    paddingTop: 18,
    paddingBottom: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: midnight.hairline,
  },
  promptInput: {
    fontFamily: mobileType.body.fontFamily,
    fontSize: 24,
    lineHeight: 31,
    color: midnight.textStrong,
    minHeight: 93,
    maxHeight: 186,
    padding: 0,
    textAlignVertical: "top",
  },
  promptBar: { flexDirection: "row", alignItems: "center", minHeight: 32 },
  draft: { ...mobileType.footnote, color: midnight.textFaint },
  spacer: { flex: 1 },
  footer: { gap: 12 },
  route: { ...mobileType.footnote, lineHeight: 17, color: midnight.textFaint, textAlign: "center" },
  error: { ...mobileType.footnote, color: midnight.failedText, textAlign: "center" },
  start: {
    height: 52,
    borderRadius: 999,
    backgroundColor: midnight.textStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  startOff: { opacity: 0.4 },
  startLabel: { ...mobileType.title, color: midnight.bg },
});

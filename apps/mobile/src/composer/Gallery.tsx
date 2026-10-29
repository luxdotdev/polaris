/**
 * A development screen of the composer's states from fixtures, for screenshots: launch a
 * development build with `-polarisDevComposer <state>` (and `-polarisDevTheme moonlit`).
 */
import {
  ApprovalRequest,
  ContextUsage,
  Model,
  ModelId,
  RequestId,
  SessionId,
  Subagent,
  SubagentId,
  TurnId,
} from "@polaris/protocol";
import { Schema } from "effect";
import { useEffect, useState } from "react";
import { Platform, Settings, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemeName, useTheme } from "../theme";
import { Composer } from "../thread/Composer.tsx";
import type { ComposerMode } from "../thread/composer.ts";
import { ModelSheet } from "./ModelSheet.tsx";
import { CHANGE_NOTES } from "./modelSheet.ts";
import { PERMISSION_MODES } from "../newSession/model.ts";
import type { ModelSheetInput } from "./useModelSheet.ts";

const GalleryState = Schema.Literals([
  "idle",
  "typed",
  "working",
  "approval",
  "subagent",
  "long",
  "question",
  "sheet",
]);

type GalleryState = typeof GalleryState.Type;

const launchArgument = <A,>(key: string, is: (value: unknown) => value is A): A | null => {
  const value: unknown = Platform.OS === "ios" ? Settings.get(key) : undefined;

  return is(value) ? value : null;
};

const STATE = __DEV__ ? launchArgument("polarisDevComposer", Schema.is(GalleryState)) : null;

export const composerGalleryOn = (): boolean => STATE !== null;

const at = new Date(Date.now() - 72_000).toISOString();

const sessionId = SessionId.make("gallery");

const ask = (id: string, fields: Partial<ApprovalRequest>) =>
  new ApprovalRequest({
    id: RequestId.make(id),
    sessionId,
    turnId: TurnId.make("t"),
    kind: "command",
    title: "Run a command",
    detail: null,
    options: [],
    questions: [],
    openedAt: at,
    ...fields,
  });

const helper = (n: number) =>
  new Subagent({
    id: SubagentId.make(`s${n}`),
    sessionId,
    turnId: TurnId.make("t"),
    parentItemId: null,
    title: `Helper ${n}`,
    agent: "Explore",
    model: null,
    status: "working",
    startedAt: at,
    endedAt: null,
  });

const REQUESTS: Readonly<Record<GalleryState, ReadonlyArray<ApprovalRequest>>> = {
  idle: [],
  typed: [],
  working: [],
  approval: [ask("a", { detail: "bun run build" })],
  subagent: [
    ask("a", { detail: "bun run build" }),
    ask("b", {
      kind: "file-change",
      detail: "apps/site/public/index.html",
      openedAt: new Date(Date.now() - 30_000).toISOString(),
    }),
  ],
  long: [ask("a", { detail: "bun run --cwd apps/mobile test -- src/composer\nbun run lint" })],
  question: [
    ask("q", { kind: "question", title: "Which base?", options: ["main", "phase-1 branch"] }),
  ],
  sheet: [],
};

const MODELS = [
  new Model({
    id: ModelId.make("opus"),
    name: "Opus 5.5",
    description: "Most capable",
    efforts: ["low", "medium", "high", "max"],
    defaultEffort: "high",
    isDefault: true,
  }),
  new Model({
    id: ModelId.make("sonnet"),
    name: "Sonnet 5.5",
    description: "Fast and capable",
    efforts: ["low", "medium", "high"],
    defaultEffort: "medium",
    isDefault: false,
  }),
];

const sheetInput = (open: boolean, setOpen: (open: boolean) => void): ModelSheetInput => ({
  open,
  setOpen,
  harness: "claude",
  models: MODELS,
  model: MODELS[0] ?? null,
  label: "Opus 5.5",
  effort: "high",
  change: { kind: "set" },
  note: CHANGE_NOTES.set,
  forkTo: [{ kind: "codex", name: "Codex", status: "ready", startable: true }],
  permission: "auto-edits",
  permissions: PERMISSION_MODES,
  error: null,
  pickModel: () => undefined,
  pickPermission: () => undefined,
  forkOn: () => undefined,
});

const working = (state: GalleryState) =>
  state === "working" || state === "subagent" || state === "approval";

const modeOf = (state: GalleryState): ComposerMode =>
  working(state) ? { kind: "steer" } : { kind: "send" };

export const ComposerGallery = () => {
  const { colours, setTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const state = STATE ?? "idle";
  const [open, setOpen] = useState(state === "sheet");
  const [text, setText] = useState(state === "typed" ? "Now write the release timeline" : "");

  useEffect(() => {
    const theme = launchArgument("polarisDevTheme", Schema.is(ThemeName));

    if (theme !== null) setTheme(theme);
    // Launch arguments are read once.
  }, []);

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "flex-end",
        backgroundColor: colours.ground,
        paddingHorizontal: 10,
        paddingBottom: insets.bottom,
      }}
    >
      <Composer
        mode={modeOf(state)}
        text={text}
        harness="claude"
        model="Opus 5.5"
        celestial={null}
        workingSince={working(state) ? at : null}
        draftStatus="saved"
        error={null}
        requests={{
          requests: REQUESTS[state],
          answering: [],
          errors: new Map(),
          enabled: true,
          onRespond: () => undefined,
        }}
        subagents={state === "subagent" ? [helper(0), helper(1), helper(2)] : []}
        contextUsage={new ContextUsage({ usedTokens: 34_000, windowTokens: 200_000 })}
        onChange={setText}
        onSend={() => undefined}
        onQueue={() => undefined}
        onStop={() => undefined}
      />
      <ModelSheet input={sheetInput(open, setOpen)} />
    </View>
  );
};

/**
 * The glasses app as a pure state: which screen shows, what the Hosts look
 * like, and what each input or feed update changes. Side effects come back as
 * an `Act` for the controller to run.
 */
import type { HostView } from "@polaris/sdk";
import { type MenuAction, type MenuItem, menuFor, type TurnStatus } from "./menu.ts";
import { findRow, type SessionKey, sameKey, sessionRows } from "./sessions.ts";

export type VoicePhase = "listening" | "finishing" | "review" | "failed";

export interface Voice {
  readonly phase: VoicePhase;
  readonly finalText: string;
  readonly interimText: string;
  /** Why the transcription failed, in the failed phase. */
  readonly error: string | null;
}

export type Screen =
  | { readonly kind: "sessions" }
  | { readonly kind: "session"; readonly key: SessionKey }
  | { readonly kind: "menu"; readonly key: SessionKey; readonly items: ReadonlyArray<MenuItem> }
  | { readonly kind: "voice"; readonly key: SessionKey; readonly voice: Voice };

export interface AppState {
  readonly paired: boolean;
  readonly hosts: ReadonlyArray<HostView>;
  readonly screen: Screen;
  /** A one-line outcome ("Approved", "Can't reach Mac Studio"), cleared on the next move. */
  readonly notice: string | null;
  /** Approvals already seen; null until the first Hosts update. */
  readonly seen: ReadonlySet<string> | null;
  /** The latest Turn's status for the session on screen. */
  readonly lastTurn: { readonly key: SessionKey; readonly status: TurnStatus } | null;
}

export type Act =
  | { readonly kind: "run"; readonly key: SessionKey; readonly action: MenuAction }
  | { readonly kind: "listen"; readonly key: SessionKey }
  | { readonly kind: "stop-listening" }
  | { readonly kind: "cancel-voice" }
  | {
      readonly kind: "send-voice";
      readonly key: SessionKey;
      readonly text: string;
      /** The question it answers, or null to send it as a Turn. */
      readonly requestId: string | null;
    }
  | { readonly kind: "exit" };

export type Input =
  | { readonly kind: "click"; readonly index: number }
  | { readonly kind: "double-click" }
  | { readonly kind: "long-press" }
  | { readonly kind: "long-press-release" };

export type Step = readonly [AppState, Act | null];

export const initialState = (paired: boolean): AppState => ({
  paired,
  hosts: [],
  screen: { kind: "sessions" },
  notice: null,
  seen: null,
  lastTurn: null,
});

const listening: Voice = { phase: "listening", finalText: "", interimText: "", error: null };

/** The voice screen's choices, in list order. */
export const VOICE_CHOICES: Record<"review" | "failed", ReadonlyArray<string>> = {
  review: ["Send", "Retry", "Cancel"],
  failed: ["Retry", "Cancel"],
};

const to = (state: AppState, screen: Screen, act: Act | null = null): Step => [
  { ...state, screen, notice: null },
  act,
];

const keyOf = (screen: Screen): SessionKey | null =>
  screen.kind === "sessions" ? null : screen.key;

export const lastTurnOf = (state: AppState, key: SessionKey) =>
  state.lastTurn !== null && sameKey(state.lastTurn.key, key) ? state.lastTurn.status : null;

const openQuestion = (state: AppState, key: SessionKey) => {
  const approval = findRow(state.hosts, key)?.entry.pendingApprovals[0];

  return approval?.kind === "question" ? approval.id : null;
};

const onSessions = (state: AppState, input: Input): Step => {
  if (input.kind === "double-click") return [state, { kind: "exit" }];

  if (input.kind !== "click") return [state, null];
  const row = sessionRows(state.hosts)[input.index];

  return row === undefined ? [state, null] : to(state, { kind: "session", key: row.key });
};

const onSession = (state: AppState, key: SessionKey, input: Input): Step => {
  const row = findRow(state.hosts, key);

  if (input.kind === "double-click") return to(state, { kind: "sessions" });

  if (row === undefined) return [state, null];

  if (input.kind === "click")
    return to(state, { kind: "menu", key, items: menuFor(row.entry, lastTurnOf(state, key)) });

  if (input.kind === "long-press")
    return to(state, { kind: "voice", key, voice: listening }, { kind: "listen", key });

  return [state, null];
};

const onMenu = (
  state: AppState,
  key: SessionKey,
  items: ReadonlyArray<MenuItem>,
  input: Input
): Step => {
  if (input.kind === "double-click") return to(state, { kind: "session", key });

  if (input.kind !== "click") return [state, null];
  const item = items[input.index];

  if (item === undefined) return [state, null];

  if (item.action.kind === "speak")
    return to(state, { kind: "voice", key, voice: listening }, { kind: "listen", key });

  return to(state, { kind: "session", key }, { kind: "run", key, action: item.action });
};

const onVoiceChoice = (state: AppState, key: SessionKey, voice: Voice, choice: string): Step => {
  if (choice === "Send")
    return to(
      state,
      { kind: "session", key },
      { kind: "send-voice", key, text: voice.finalText.trim(), requestId: openQuestion(state, key) }
    );

  if (choice === "Retry")
    return to(state, { kind: "voice", key, voice: listening }, { kind: "listen", key });

  if (choice === "Cancel") return to(state, { kind: "session", key });

  return [state, null];
};

const onVoice = (state: AppState, key: SessionKey, voice: Voice, input: Input): Step => {
  if (input.kind === "double-click")
    return to(
      state,
      { kind: "session", key },
      voice.phase === "listening" || voice.phase === "finishing" ? { kind: "cancel-voice" } : null
    );

  if (
    voice.phase === "listening" &&
    (input.kind === "click" || input.kind === "long-press-release")
  )
    return to(
      state,
      { kind: "voice", key, voice: { ...voice, phase: "finishing" } },
      { kind: "stop-listening" }
    );

  if ((voice.phase === "review" || voice.phase === "failed") && input.kind === "click") {
    const choice = VOICE_CHOICES[voice.phase][input.index];

    return choice === undefined ? [state, null] : onVoiceChoice(state, key, voice, choice);
  }

  return [state, null];
};

const route = (state: AppState, input: Input): Step => {
  const screen = state.screen;

  if (!state.paired)
    return input.kind === "double-click" ? [state, { kind: "exit" }] : [state, null];

  switch (screen.kind) {
    case "sessions":
      return onSessions(state, input);
    case "session":
      return onSession(state, screen.key, input);
    case "menu":
      return onMenu(state, screen.key, screen.items, input);
    case "voice":
      return onVoice(state, screen.key, screen.voice, input);
  }
};

/** The newest approval not seen before, which jumps to the front unless voice is in use. */
const jump = (state: AppState): AppState => {
  const approvals = state.hosts.flatMap((host) =>
    host.approvals.map((approval) => ({ hostId: host.hostId, approval }))
  );

  const ids = approvals.map(({ approval }) => approval.id);

  if (state.seen === null) return { ...state, seen: new Set(ids) };

  if (state.screen.kind === "voice") return state;
  const seen = state.seen;
  const fresh = approvals.filter(({ approval }) => !seen.has(approval.id));

  const newest = fresh.toSorted((a, b) =>
    b.approval.openedAt.localeCompare(a.approval.openedAt)
  )[0];

  const next = { ...state, seen: new Set(ids) };

  return newest === undefined
    ? next
    : {
        ...next,
        notice: null,
        screen: {
          kind: "session",
          key: { hostId: newest.hostId, sessionId: newest.approval.sessionId },
        },
      };
};

/** A session that disappeared (archived, or its Host unpaired) sends the screen back to the list. */
const stillThere = (state: AppState): AppState => {
  const key = keyOf(state.screen);

  return key === null || findRow(state.hosts, key) !== undefined
    ? state
    : { ...state, screen: { kind: "sessions" } };
};

const settle = (state: AppState): AppState => jump(stillThere(state));

/** Leaving the voice screen lets an approval that arrived meanwhile jump to the front. */
export const onInput = (state: AppState, input: Input): Step => {
  const [next, act] = route(state, input);

  return [settle(next), act];
};

export const onHosts = (state: AppState, hosts: ReadonlyArray<HostView>): AppState =>
  settle({ ...state, hosts });

export const onLastTurn = (state: AppState, key: SessionKey, status: TurnStatus): AppState => ({
  ...state,
  lastTurn: { key, status },
});

const withVoice = (state: AppState, change: (voice: Voice) => Voice): AppState =>
  state.screen.kind === "voice"
    ? { ...state, screen: { ...state.screen, voice: change(state.screen.voice) } }
    : state;

export const onTranscript = (
  state: AppState,
  transcript: {
    readonly finalText: string;
    readonly interimText: string;
    readonly finished: boolean;
  }
): AppState =>
  withVoice(state, (voice) => {
    const heard = {
      ...voice,
      finalText: transcript.finalText,
      interimText: transcript.interimText,
    };

    if (!transcript.finished) return heard;

    return transcript.finalText.trim() === ""
      ? { ...heard, phase: "failed", error: "Didn't catch anything" }
      : { ...heard, phase: "review", interimText: "" };
  });

export const onVoiceFailed = (state: AppState, error: string): AppState =>
  withVoice(state, (voice) => ({ ...voice, phase: "failed", error }));

export const onNotice = (state: AppState, notice: string): AppState => ({ ...state, notice });

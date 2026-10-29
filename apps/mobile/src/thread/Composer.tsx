/**
 * The composer (Paper MX-E): suggested chips above it; inside, the floating notice strip, the
 * field, and one row of the model chip (its sheet holds harness, model, effort and permissions),
 * the Subagents' moons, the context ring, attach, mic, and Send, or Stop while a Turn works.
 */
import type { CelestialBody, ContextUsage, HarnessKind, Subagent } from "@polaris/protocol";
import type { DraftStatus } from "@polaris/client/continuity";
import { mobileType } from "@polaris/ui/tokens";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ContextRing, ModelChip, SendButton, SubagentMoons } from "../composer/ControlRow.tsx";
import { ModelControl } from "../composer/ModelControl.tsx";
import { contextRing, moonsOf } from "../composer/controlRow.ts";
import {
  AttachButton,
  type AttachInput,
  AttachmentChips,
  MicButton,
  type VoiceInput,
} from "../composer/controls.tsx";
import type { ModelSheetContext } from "../composer/useModelSheet.ts";
import { usePastedImages } from "../composer/usePastedImages.ts";
import { haptics } from "../motion";
import { useTheme } from "../theme";
import { type ComposerMode, placeholderFor } from "./composer.ts";
import { PendingRequests, type PendingRequestsProps } from "./PendingRequests.tsx";
import { Diamond } from "./Row.tsx";
import type { Suggestion } from "./suggestions.ts";

export const Suggestions = ({
  items,
  onPick,
}: {
  readonly items: ReadonlyArray<Suggestion>;
  readonly onPick: (item: Suggestion) => void;
}) => {
  const { colours } = useTheme();

  return items.length === 0 ? null : (
    <View style={styles.suggested}>
      <Text style={[styles.suggestedLabel, { color: colours.textFaint }]}>Suggested</Text>
      <View style={styles.chips}>
        {items.map((item) => (
          <Pressable
            key={item.kind}
            style={[styles.chip, { borderColor: colours.hairline }]}
            onPress={() => onPick(item)}
            accessibilityRole="button"
          >
            {item.kind === "fix" ? <Diamond /> : null}
            <Text style={[styles.chipLabel, { color: colours.textDefault }]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

export interface ComposerProps {
  readonly mode: ComposerMode;
  readonly text: string;
  readonly harness: HarnessKind;
  readonly model: string | null;
  readonly celestial?: CelestialBody | null | undefined;
  /** When the Turn in flight started; null when none is working. */
  readonly workingSince: string | null;
  readonly draftStatus: DraftStatus | null;
  readonly error: string | null;
  /** The session's open requests, for the notice strip; null shows none. */
  readonly requests?: PendingRequestsProps | null;
  readonly subagents?: ReadonlyArray<Subagent>;
  readonly contextUsage?: ContextUsage | null;
  /** What the model sheet changes; null leaves the chip a label. */
  readonly sheet?: ModelSheetContext | null;
  /** Attach, where the Host stages attachments; null hides it. */
  readonly attach?: AttachInput | null;
  /** Attachments are still on their way: Send waits for them. */
  readonly attaching?: boolean;
  /** The mic, where the Host transcribes voice; null hides it. */
  readonly voice?: VoiceInput | null;
  readonly onChange: (text: string) => void;
  readonly onSend: () => void;
  readonly onQueue: () => void;
  readonly onStop: () => void;
}

/** What's said over the field: an error, a dictation or attach problem, or a draft not saved. */
const noticeOf = (props: ComposerProps): { text: string; failed: boolean } | null => {
  if (props.error !== null) return { text: props.error, failed: true };
  const failure = props.voice?.failure ?? null;

  if (failure !== null) return { text: failure, failed: true };
  const caption = props.attach?.caption ?? null;

  if (caption !== null) return { text: caption, failed: false };

  return props.draftStatus === "unsaved" ? { text: "Draft not saved", failed: false } : null;
};

export const Composer = (props: ComposerProps) => {
  const { colours } = useTheme();
  const { mode, text, harness, workingSince, attach = null, voice = null, sheet = null } = props;
  const blocked = mode.kind === "blocked";
  const working = workingSince !== null;
  const empty = text.trim() === "" || props.attaching === true;
  const stop = working && text.trim() === "";
  const notice = noticeOf(props);
  const fieldId = usePastedImages(attach, !blocked);

  const send = () => {
    if (stop) {
      haptics.stop();
      props.onStop();
    } else {
      haptics.send();
      props.onSend();
    }
  };

  return (
    <View style={[styles.box, { backgroundColor: colours.panel, borderColor: colours.hairline }]}>
      {props.requests == null ? null : (
        <PendingRequests {...props.requests} harness={harness} workingSince={workingSince} />
      )}
      <View style={styles.field}>
        {attach === null ? null : <AttachmentChips attach={attach} />}
        {notice === null ? null : (
          <Text
            style={[
              styles.notice,
              { color: notice.failed ? colours.failedText : colours.textSubtle },
            ]}
          >
            {notice.text}
          </Text>
        )}
        <TextInput
          style={[styles.input, { color: colours.textStrong }]}
          value={text}
          onChangeText={props.onChange}
          placeholder={placeholderFor(mode)}
          placeholderTextColor={colours.textFaint}
          editable={!blocked}
          multiline
          accessibilityLabel="Message"
          nativeID={fieldId}
        />
      </View>
      <View style={styles.row}>
        {sheet === null ? (
          <ModelChip
            harness={harness}
            celestial={props.celestial ?? null}
            label={props.model ?? "Default"}
            working={working}
            onPress={null}
          />
        ) : (
          <ModelControl context={sheet} celestial={props.celestial ?? null} working={working} />
        )}
        <SubagentMoons harness={harness} moons={moonsOf(props.subagents ?? [])} />
        <View style={styles.spring} />
        <ContextRing ring={contextRing(props.contextUsage ?? null)} />
        {attach === null || blocked ? null : <AttachButton onPress={attach.pick} compact />}
        {voice === null || blocked ? null : <MicButton voice={voice} large />}
        {mode.kind === "steer" && !empty ? (
          <Pressable
            onPress={() => {
              haptics.send();
              props.onQueue();
            }}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text style={[styles.queue, { color: colours.textDefault }]}>Queue</Text>
          </Pressable>
        ) : null}
        <SendButton
          stop={stop}
          disabled={!stop && (empty || blocked)}
          label={mode.kind === "queue" ? "Queue a follow-up" : "Send"}
          onPress={send}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  suggested: { gap: 10, marginHorizontal: 4 },
  suggestedLabel: { ...mobileType.footnote, fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipLabel: { ...mobileType.subhead, fontWeight: "500" },
  box: { borderRadius: 22, borderWidth: 1, padding: 6, gap: 6 },
  field: { gap: 8, paddingHorizontal: 6, paddingTop: 4 },
  notice: { ...mobileType.footnote },
  input: {
    ...mobileType.body,
    fontSize: 16,
    lineHeight: 21,
    minHeight: 36,
    maxHeight: 140,
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  spring: { flex: 1 },
  queue: { ...mobileType.footnote, fontWeight: "500", paddingHorizontal: 4 },
});

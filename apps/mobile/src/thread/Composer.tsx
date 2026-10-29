/**
 * The composer (M4): suggested chips, the Working strip with Stop while a
 * Turn runs, the text field, the Harness and Model chip, "Draft saved" once
 * the Host holds the draft, Queue while a Turn runs, and Send.
 */
import type { DraftStatus } from "@polaris/client/continuity";
import type { HarnessKind } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  AttachButton,
  type AttachInput,
  AttachmentChips,
  MicButton,
  type VoiceInput,
} from "../composer/controls.tsx";
import { usePastedImages } from "../composer/usePastedImages.ts";
import { Dither } from "../dither/index.ts";
import { haptics } from "../motion/index.ts";
import { type ComposerMode, placeholderFor } from "./composer.ts";
import { elapsed, harnessHue, harnessName } from "./labels.ts";
import { Diamond } from "./Row.tsx";
import type { Suggestion } from "./suggestions.ts";

const DRAFT_WORDS: Readonly<Record<DraftStatus, string>> = {
  saved: "Draft saved",
  saving: "Saving draft…",
  unsaved: "Draft not saved",
};

/** Ticks once a second, only while a Turn is working. */
const useElapsed = (since: string | null): string | null => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [since]);

  return since === null ? null : elapsed(now - Date.parse(since));
};

const WorkingStrip = ({
  harness,
  since,
  onStop,
}: {
  readonly harness: HarnessKind;
  readonly since: string;
  readonly onStop: () => void;
}) => {
  const time = useElapsed(since);
  const hue = harnessHue(harness);

  return (
    <View style={styles.strip}>
      <Dither color={hue} size={14} moving />
      <Text style={[styles.stripLabel, { color: hue }]}>{harnessName(harness)} is working</Text>
      <Text style={styles.stripTime}>· {time}</Text>
      <Pressable style={styles.stop} onPress={onStop} accessibilityRole="button" hitSlop={8}>
        <View style={styles.stopSquare} />
        <Text style={styles.stopLabel}>Stop</Text>
      </Pressable>
    </View>
  );
};

export const Suggestions = ({
  items,
  onPick,
}: {
  readonly items: ReadonlyArray<Suggestion>;
  readonly onPick: (item: Suggestion) => void;
}) =>
  items.length === 0 ? null : (
    <View style={styles.suggested}>
      <Text style={styles.suggestedLabel}>Suggested</Text>
      <View style={styles.chips}>
        {items.map((item) => (
          <Pressable
            key={item.kind}
            style={styles.chip}
            onPress={() => onPick(item)}
            accessibilityRole="button"
          >
            {item.kind === "fix" ? <Diamond /> : null}
            <Text style={styles.chipLabel}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

export interface ComposerProps {
  readonly mode: ComposerMode;
  readonly text: string;
  readonly harness: HarnessKind;
  readonly model: string | null;
  /** When the Turn in flight started; null when none is working. */
  readonly workingSince: string | null;
  readonly draftStatus: DraftStatus | null;
  readonly error: string | null;
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

const ModelChip = ({
  harness,
  model,
}: {
  readonly harness: HarnessKind;
  readonly model: string | null;
}) => {
  const hue = harnessHue(harness);

  return (
    <View style={[styles.modelChip, { borderColor: `${hue}40` }]}>
      <View style={[styles.harnessTile, { backgroundColor: hue }]} />
      <Text style={[styles.harnessName, { color: hue }]}>{harnessName(harness)}</Text>
      <Text style={styles.modelName} numberOfLines={1}>
        {model ?? "default model"}
      </Text>
    </View>
  );
};

export const Composer = (props: ComposerProps) => {
  const { mode, text, harness, workingSince, attach = null, voice = null } = props;
  const blocked = mode.kind === "blocked";
  const empty = text.trim() === "" || props.attaching === true;
  const hue = harnessHue(harness);
  // Voice and attach say what's happening on a line of their own: a missing key's message is long.
  const notice = voice?.failure ?? attach?.caption ?? null;
  const fieldId = usePastedImages(attach, !blocked);

  const stopWithTap = () => {
    haptics.stop();
    props.onStop();
  };

  const footnote =
    props.error ?? (props.draftStatus === null ? "" : DRAFT_WORDS[props.draftStatus]);

  return (
    <View style={[styles.box, workingSince === null ? null : { borderColor: `${hue}40` }]}>
      {workingSince === null ? null : (
        <WorkingStrip harness={harness} since={workingSince} onStop={stopWithTap} />
      )}
      <View style={styles.body}>
        {attach === null ? null : <AttachmentChips attach={attach} />}
        {notice === null ? null : (
          <Text style={[styles.notice, voice?.failure ? styles.footnoteError : null]}>
            {notice}
          </Text>
        )}
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={props.onChange}
          placeholder={placeholderFor(mode)}
          placeholderTextColor={midnight.textFaint}
          editable={!blocked}
          multiline
          accessibilityLabel="Message"
          nativeID={fieldId}
        />
        <View style={styles.footer}>
          {attach === null || blocked ? null : <AttachButton onPress={attach.pick} compact />}
          <ModelChip harness={harness} model={props.model} />
          <Text
            style={[styles.footnote, props.error === null ? null : styles.footnoteError]}
            numberOfLines={1}
          >
            {footnote}
          </Text>
          {voice === null || blocked ? null : <MicButton voice={voice} />}
          {mode.kind === "steer" ? (
            <Pressable
              onPress={() => {
                haptics.send();
                props.onQueue();
              }}
              disabled={empty}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={[styles.queue, empty ? styles.dim : null]}>Queue</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.send, empty || blocked ? styles.dim : null]}
            onPress={() => {
              haptics.send();
              props.onSend();
            }}
            disabled={empty || blocked}
            accessibilityRole="button"
            accessibilityLabel={mode.kind === "queue" ? "Queue a follow-up" : "Send"}
          >
            <Text style={styles.sendArrow}>↑</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  suggested: { gap: 10, marginHorizontal: 4 },
  suggestedLabel: {
    ...mobileType.footnote,
    fontSize: 12,
    lineHeight: 16,
    color: midnight.textFaint,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ffffff1f",
  },
  chipLabel: { ...mobileType.subhead, fontWeight: "500", color: midnight.textDefault },
  box: {
    backgroundColor: midnight.surfaceSunken,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: midnight.hairline,
    overflow: "hidden",
  },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 36,
    paddingLeft: 14,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: midnight.hairline,
  },
  stripLabel: { ...mobileType.footnote, fontWeight: "500" },
  stripTime: { ...mobileType.footnote, color: midnight.textFaint, flex: 1 },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: midnight.surfaceRaised,
  },
  stopSquare: { width: 8, height: 8, borderRadius: 1, backgroundColor: midnight.textDefault },
  stopLabel: { ...mobileType.footnote, fontWeight: "500", color: midnight.textDefault },
  body: { gap: 12, paddingTop: 14, paddingBottom: 10, paddingLeft: 16, paddingRight: 14 },
  input: {
    ...mobileType.body,
    fontSize: 16,
    color: midnight.textStrong,
    maxHeight: 140,
    padding: 0,
  },
  footer: { flexDirection: "row", alignItems: "center", gap: 10 },
  modelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 30,
    paddingLeft: 6,
    paddingRight: 10,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 1,
  },
  harnessTile: { width: 18, height: 18, borderRadius: 5, opacity: 0.6 },
  harnessName: { ...mobileType.footnote, fontWeight: "500" },
  modelName: { ...mobileType.footnote, color: midnight.textSubtle, flexShrink: 1 },
  footnote: { ...mobileType.footnote, color: midnight.textFaint, flex: 1 },
  footnoteError: { color: midnight.failedText },
  notice: { ...mobileType.footnote, color: midnight.textSubtle },
  queue: { ...mobileType.footnote, fontWeight: "500", color: midnight.textDefault },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: midnight.textStrong,
  },
  sendArrow: { fontSize: 18, lineHeight: 20, fontWeight: "500", color: midnight.bg },
  dim: { opacity: 0.4 },
});

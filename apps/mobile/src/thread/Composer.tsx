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

/** A still dither tile in the Harness hue; the Working strip's mark. */
const DitherMark = ({ hue }: { readonly hue: string }) => (
  <View style={styles.dither}>
    {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((cell) => (
      <View
        key={cell}
        style={[styles.ditherCell, cell % 2 === 0 ? { backgroundColor: hue } : null]}
      />
    ))}
  </View>
);

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
      <DitherMark hue={hue} />
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
  const { mode, text, harness, workingSince } = props;
  const blocked = mode.kind === "blocked";
  const empty = text.trim() === "";
  const hue = harnessHue(harness);

  const footnote =
    props.error ?? (props.draftStatus === null ? "" : DRAFT_WORDS[props.draftStatus]);

  return (
    <View style={[styles.box, workingSince === null ? null : { borderColor: `${hue}40` }]}>
      {workingSince === null ? null : (
        <WorkingStrip harness={harness} since={workingSince} onStop={props.onStop} />
      )}
      <View style={styles.body}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={props.onChange}
          placeholder={placeholderFor(mode)}
          placeholderTextColor={midnight.textFaint}
          editable={!blocked}
          multiline
          accessibilityLabel="Message"
        />
        <View style={styles.footer}>
          <ModelChip harness={harness} model={props.model} />
          <Text
            style={[styles.footnote, props.error === null ? null : styles.footnoteError]}
            numberOfLines={1}
          >
            {footnote}
          </Text>
          {mode.kind === "steer" ? (
            <Pressable
              onPress={props.onQueue}
              disabled={empty}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={[styles.queue, empty ? styles.dim : null]}>Queue</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.send, empty || blocked ? styles.dim : null]}
            onPress={props.onSend}
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
  dither: { width: 12, height: 12, flexDirection: "row", flexWrap: "wrap" },
  ditherCell: { width: 4, height: 4 },
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
    maxWidth: 200,
  },
  harnessTile: { width: 18, height: 18, borderRadius: 5, opacity: 0.6 },
  harnessName: { ...mobileType.footnote, fontWeight: "500" },
  modelName: { ...mobileType.footnote, color: midnight.textSubtle, flexShrink: 1 },
  footnote: { ...mobileType.footnote, color: midnight.textFaint, flex: 1 },
  footnoteError: { color: midnight.failedText },
  queue: { ...mobileType.footnote, fontWeight: "500", color: midnight.textDefault },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: midnight.textStrong,
  },
  sendArrow: { fontSize: 18, lineHeight: 20, fontWeight: "600", color: midnight.bg },
  dim: { opacity: 0.4 },
});

/**
 * A shared session's queue over the composer (ENG-941): "Queued", each Turn's author and prompt,
 * Edit and Cancel for its author or the owner, and "Queue paused · N Turns" with Resume.
 */
import type { QueuedTurn } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { themedStyles, useTheme } from "../theme/index.ts";
import { CHROME_TEXT_SCALE, CONTENT_TEXT_SCALE } from "../theme/textScale.ts";
import { bylineOf, sendsTurns } from "./model.ts";
import { mayChangeQueued, pausedLine } from "./queue.ts";
import { Avatar } from "./RowParts.tsx";
import type { SharedThread } from "./useSharedThread.ts";

const Action = ({ label, onPress }: { readonly label: string; readonly onPress: () => void }) => {
  const styles = useStyles();

  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={styles.action}>
      <Text style={styles.actionLabel} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
        {label}
      </Text>
    </Pressable>
  );
};

const Row = ({
  queued,
  shared,
}: {
  readonly queued: QueuedTurn;
  readonly shared: SharedThread;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const [editing, setEditing] = useState<string | null>(null);
  const byline = bylineOf(queued.actor, shared.viewer);

  const save = () => {
    if (editing !== null && editing.trim() !== "" && editing !== queued.prompt)
      void shared.editQueued(queued.id, editing);
    setEditing(null);
  };

  return (
    <View style={styles.row}>
      {byline.initials === "" ? null : <Avatar initials={byline.initials} size={18} />}
      <Text style={styles.author} maxFontSizeMultiplier={CONTENT_TEXT_SCALE} numberOfLines={1}>
        {byline.label}
      </Text>
      {editing === null ? (
        <Text style={styles.prompt} maxFontSizeMultiplier={CONTENT_TEXT_SCALE} numberOfLines={1}>
          {queued.prompt}
        </Text>
      ) : (
        <TextInput
          autoFocus
          style={styles.input}
          value={editing}
          onChangeText={setEditing}
          onSubmitEditing={save}
          returnKeyType="done"
          placeholderTextColor={colours.textFaint}
          maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
        />
      )}
      {!mayChangeQueued(queued, shared.viewer) ? null : editing === null ? (
        <>
          <Action label="Edit" onPress={() => setEditing(queued.prompt)} />
          <Action label="Cancel" onPress={() => void shared.cancelQueued(queued.id)} />
        </>
      ) : (
        <Action label="Save" onPress={save} />
      )}
    </View>
  );
};

export const QueuedTurns = ({ shared }: { readonly shared: SharedThread }) => {
  const styles = useStyles();
  const { turns, paused } = shared.queue;

  if (turns.length === 0) return null;

  return (
    <View style={styles.queue}>
      <View style={styles.head}>
        <Text style={styles.kicker} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
          {paused ? pausedLine(turns.length) : "QUEUED"}
        </Text>
        {paused && sendsTurns(shared.viewer) ? (
          <Action label="Resume" onPress={() => void shared.resumeQueue()} />
        ) : null}
      </View>
      {turns.map((queued) => (
        <Row key={queued.id} queued={queued} shared={shared} />
      ))}
    </View>
  );
};

const useStyles = themedStyles((c) => ({
  queue: {
    borderTopWidth: 1,
    borderColor: c.hairline,
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 2,
  },
  head: { flexDirection: "row", alignItems: "center", minHeight: 28, gap: 8 },
  kicker: { ...mobileType.footnote, color: c.textSubtle, flex: 1, letterSpacing: 0.6 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 36, gap: 8 },
  author: { ...mobileType.callout, color: c.textStrong, fontWeight: "500", flexShrink: 0 },
  prompt: { ...mobileType.callout, color: c.textSubtle, flex: 1 },
  input: {
    ...mobileType.callout,
    color: c.textStrong,
    flex: 1,
    borderBottomWidth: 1,
    borderColor: c.hairline,
    paddingVertical: 4,
  },
  action: { minHeight: 32, justifyContent: "center", paddingHorizontal: 6 },
  actionLabel: { ...mobileType.callout, color: c.textDefault, fontWeight: "500" },
}));

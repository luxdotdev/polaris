/**
 * A shared session's thread chrome (SS6): who is watching and the role chip or share icon in the
 * header, the Comment composer with a Commenter's note, and "Send N comments as a turn".
 */
import type { HarnessKind, SessionId } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { themedStyles, useTheme } from "../theme/index.ts";
import { CHROME_TEXT_SCALE, CONTENT_TEXT_SCALE } from "../theme/textScale.ts";
import { presenceFaces } from "./commands.ts";
import type { HostConnection } from "../runtime/hostConnection.ts";
import { CommentsSheet } from "./CommentsSheet.tsx";
import { commenterNote, commentOnLabel, roleWord, type Viewer } from "./model.ts";
import { Avatar } from "./RowParts.tsx";
import { ShareSheet } from "./ShareSheet.tsx";
import type { CommentTarget, SharedThread } from "./useSharedThread.ts";

const FACES = 3;

/** The share icon: a box with an arrow up, as iOS draws Share. */
const ShareGlyph = () => {
  const { colours } = useTheme();

  return (
    <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
      <Path
        d="M9 2v9M5.5 5.5 9 2l3.5 3.5M4 9v6h10V9"
        stroke={colours.textDefault}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
};

/** Before the header's other pills: who is watching, then the role chip or Share. */
export const HeaderSharing = ({
  shared: { viewer, shown, presence },
  onShare,
}: {
  readonly shared: SharedThread;
  /** The owner's share sheet; a Teammate sees their role instead. */
  readonly onShare: () => void;
}) => {
  const styles = useStyles();
  const faces = shown ? presenceFaces(presence, viewer) : [];
  const more = faces.length - FACES;

  return (
    <View style={styles.headerSharing}>
      {faces.length < 2 ? null : (
        <View
          style={styles.faces}
          accessible
          accessibilityLabel={`Watching: ${faces.map((face) => face.label).join(", ")}`}
        >
          {faces.slice(0, FACES).map((face, index) => (
            <View key={face.key} style={index === 0 ? null : styles.overlap}>
              <Avatar initials={face.initials} size={28} />
            </View>
          ))}
          {more > 0 ? <Text style={styles.more}>{`+${more}`}</Text> : null}
        </View>
      )}
      {viewer.kind === "teammate" ? (
        <View style={styles.chip}>
          <Text style={styles.chipLabel} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
            {roleWord(viewer.role)}
          </Text>
        </View>
      ) : (
        <Pressable
          style={styles.share}
          onPress={onShare}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Share"
        >
          <ShareGlyph />
        </Pressable>
      )}
    </View>
  );
};

/**
 * The composer while a Comment is written (SS6): what it is on, the text, and Comment. A
 * Commenter's always comments, and says why there are no Turns.
 */
const CommentComposer = ({
  viewer,
  target,
  onComment,
  onCancel,
}: {
  readonly viewer: Viewer;
  /** Null for a Commenter who hasn't picked a message yet. */
  readonly target: CommentTarget | null;
  /** Resolves with the Host's refusal, or null once it took the Comment. */
  readonly onComment: (target: CommentTarget, body: string) => Promise<string | null>;
  readonly onCancel: () => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const ready = target !== null && body.trim() !== "" && !sending;

  const submit = async () => {
    if (target === null) return;
    setSending(true);
    const refused = await onComment(target, body);
    setSending(false);
    setFailure(refused);

    if (refused === null) setBody("");
  };

  return (
    <View style={styles.composer}>
      <View style={styles.quoteLine}>
        <Text style={styles.quote} numberOfLines={1} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
          {target === null ? "Long-press a message to comment on it" : commentOnLabel(target.quote)}
        </Text>
        {target === null ? null : (
          <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button">
            <Text style={styles.cancel} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
              Cancel
            </Text>
          </Pressable>
        )}
      </View>
      <TextInput
        style={styles.input}
        value={body}
        onChangeText={setBody}
        editable={target !== null}
        multiline
        placeholder={target === null ? "" : "Add a comment"}
        placeholderTextColor={colours.textFaint}
        autoFocus={target !== null}
        maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
      />
      {failure === null ? null : (
        <Text style={styles.failure} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
          {failure}
        </Text>
      )}
      <View style={styles.foot}>
        <Text style={styles.note} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
          {viewer.kind === "teammate" && viewer.role === "commenter"
            ? commenterNote(viewer.ownerName)
            : ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={!ready}
          onPress={() => void submit()}
          style={[styles.button, ready ? null : styles.disabled]}
        >
          <Text style={styles.buttonLabel} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
            {sending ? "Commenting…" : "Comment"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

/** Whether the composer writes a Comment: one was started, or a Commenter never sends Turns. */
export const commenting = ({ viewer, target }: SharedThread) =>
  target !== null || (viewer.kind === "teammate" && viewer.role === "commenter");

/** The Comment composer for `shared`'s target; a new target starts it afresh. */
export const SharedCommentComposer = ({ shared }: { readonly shared: SharedThread }) => (
  <CommentComposer
    key={shared.target?.quote ?? ""}
    viewer={shared.viewer}
    target={shared.target}
    onComment={async (target, body) => {
      const refused = await shared.comment(target, body);

      if (refused === null) shared.setTarget(null);

      return refused;
    }}
    onCancel={() => shared.setTarget(null)}
  />
);

/** The thread's sheets: a message's or a step's Comments, and the owner's Share. */
export const SharedSheets = ({
  shared,
  connection,
  sessionId,
  title,
  harness,
  sharing,
  onCloseShare,
}: {
  readonly shared: SharedThread;
  readonly connection: HostConnection;
  readonly sessionId: SessionId;
  readonly title: string;
  readonly harness: HarnessKind;
  readonly sharing: boolean;
  readonly onCloseShare: () => void;
}) => (
  <>
    <CommentsSheet
      opened={shared.opened}
      sharing={shared.rows}
      onClose={() => shared.setOpened(null)}
      onReply={shared.setTarget}
      onResolve={(comment, resolve) => void shared.resolve(comment, resolve)}
    />
    <ShareSheet
      open={sharing}
      connection={connection}
      sessionId={sessionId}
      title={title}
      harness={harness}
      onClose={onCloseShare}
    />
  </>
);

/** Over the composer while Comments wait: one Turn carries them all to the agent. */
export const SendCommentsBar = ({
  count,
  onSend,
}: {
  readonly count: number;
  readonly onSend: () => Promise<string | null>;
}) => {
  const styles = useStyles();
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (count === 0) return null;

  const send = async () => {
    setSending(true);
    setFailure(await onSend());
    setSending(false);
  };

  return (
    <View style={styles.sendRow}>
      <Pressable
        accessibilityRole="button"
        disabled={sending}
        onPress={() => void send()}
        style={({ pressed }) => [styles.sendChip, pressed && styles.disabled]}
      >
        <Text style={styles.sendLabel} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
          {sending ? "Sending…" : `Send ${count} ${count === 1 ? "comment" : "comments"} as a turn`}
        </Text>
      </Pressable>
      {failure === null ? null : (
        <Text style={styles.failure} numberOfLines={2} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
          {failure}
        </Text>
      )}
    </View>
  );
};

const useStyles = themedStyles((c) => ({
  headerSharing: { flexDirection: "row", alignItems: "center", gap: 8 },
  faces: { flexDirection: "row", alignItems: "center" },
  overlap: { marginLeft: -6 },
  more: { ...mobileType.index, color: c.textSubtle, marginLeft: 4 },
  chip: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.hairline,
    justifyContent: "center",
  },
  chipLabel: { ...mobileType.footnote, fontWeight: "500", color: c.textDefault },
  share: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: c.hairline,
    backgroundColor: c.panel,
    alignItems: "center",
    justifyContent: "center",
  },
  composer: {
    backgroundColor: c.panel,
    borderWidth: 1,
    borderColor: c.hairline,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },
  quoteLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderLeftWidth: 2,
    borderLeftColor: c.starlight,
    paddingLeft: 8,
  },
  quote: { ...mobileType.footnote, color: c.textSubtle, flex: 1 },
  cancel: { ...mobileType.footnote, color: c.textDefault },
  input: { ...mobileType.body, color: c.textStrong, minHeight: 26, maxHeight: 140 },
  foot: { flexDirection: "row", alignItems: "center", gap: 10 },
  note: { ...mobileType.footnote, color: c.textFaint, flex: 1 },
  button: {
    height: 36,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: c.starlight,
    justifyContent: "center",
  },
  disabled: { opacity: 0.45 },
  buttonLabel: { ...mobileType.label, color: c.ground },
  failure: { ...mobileType.footnote, color: c.failedText },
  sendRow: { gap: 4, alignItems: "flex-start" },
  sendChip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.hairline,
    backgroundColor: c.panel,
    justifyContent: "center",
  },
  sendLabel: { ...mobileType.subhead, color: c.textDefault },
}));

export { QueuedTurns } from "./QueuedTurns.tsx";

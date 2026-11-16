/**
 * A message's Comments, or the line threads on a step's files (DESIGN.md "Shared Sessions",
 * Mobile v1): each Comment's author and marks, Resolve or Reopen where allowed, and Reply, which
 * adds a Comment where the thread is. A new Comment on a diff line is the desktop app's for now.
 */
import type { Comment } from "@polaris/protocol";
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { Pressable, Text, View } from "react-native";
import { InstrumentSheet, SheetHeader } from "../sheet/index.tsx";
import { themedStyles } from "../theme/index.ts";
import { CHROME_TEXT_SCALE, CONTENT_TEXT_SCALE } from "../theme/textScale.ts";
import {
  authorName,
  commentMarks,
  lineThreads,
  mayResolve,
  messageComments,
  stepComments,
} from "./model.ts";
import type { CommentTarget, CommentsOpen, RowSharing } from "./useSharedThread.ts";

const CommentItem = ({
  comment,
  sharing,
  onResolve,
}: {
  readonly comment: Comment;
  readonly sharing: RowSharing;
  readonly onResolve: (comment: Comment, resolve: boolean) => void;
}) => {
  const styles = useStyles();
  const marks = commentMarks(comment, sharing.turnNumber);
  const resolved = comment.resolvedAt != null;

  return (
    <View style={[styles.comment, resolved ? styles.resolved : null]}>
      <Text style={styles.head} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        <Text style={styles.author}>{authorName(comment.author, sharing.viewer)}</Text>
        {marks.length === 0 ? "" : ` · ${marks.join(" · ")}`}
      </Text>
      <Text style={styles.body} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        {comment.body}
      </Text>
      {mayResolve(comment, sharing.viewer) ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => onResolve(comment, !resolved)}
        >
          <Text style={styles.action} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
            {resolved ? "Reopen" : "Resolve"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const Reply = ({ onPress }: { readonly onPress: () => void }) => {
  const styles = useStyles();

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.reply}>
      <Text style={styles.replyLabel} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
        Reply
      </Text>
    </Pressable>
  );
};

export const CommentsSheet = ({
  opened,
  sharing,
  onClose,
  onReply,
  onResolve,
}: {
  readonly opened: CommentsOpen | null;
  readonly sharing: RowSharing | undefined;
  readonly onClose: () => void;
  /** Closes the sheet and starts a Comment on `target` in the composer. */
  readonly onReply: (target: CommentTarget) => void;
  readonly onResolve: (comment: Comment, resolve: boolean) => void;
}) => {
  const styles = useStyles();

  if (opened === null || sharing === undefined) return null;

  const reply = (target: CommentTarget) => {
    onClose();
    onReply(target);
  };

  const body =
    opened.kind === "message" ? (
      <View style={styles.thread}>
        {messageComments(sharing.comments, opened.messageId).map((comment) => (
          <CommentItem key={comment.id} comment={comment} sharing={sharing} onResolve={onResolve} />
        ))}
        <Reply onPress={() => reply(opened.target)} />
      </View>
    ) : (
      lineThreads(stepComments(sharing.comments, opened.turnId, opened.paths)).map((thread) => (
        <View key={thread.key} style={styles.thread}>
          <Text style={styles.place} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
            {thread.place}
          </Text>
          <Text style={styles.code} numberOfLines={6} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
            {thread.code}
          </Text>
          {thread.comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              sharing={sharing}
              onResolve={onResolve}
            />
          ))}
          <Reply
            onPress={() =>
              reply({ anchor: thread.anchor, quote: `${thread.place} ${thread.code}` })
            }
          />
        </View>
      ))
    );

  return (
    <InstrumentSheet open onClose={onClose}>
      <SheetHeader
        title={opened.kind === "message" ? "Comments" : opened.label}
        onClose={onClose}
      />
      {body}
    </InstrumentSheet>
  );
};

const useStyles = themedStyles((c) => ({
  thread: { gap: 10, paddingHorizontal: 16, paddingBottom: 16 },
  place: { ...mobileType.index, color: c.textSubtle },
  code: {
    fontFamily: mobileFont.mono,
    fontSize: 13,
    lineHeight: 18,
    color: c.textDefault,
    backgroundColor: c.panel,
    borderRadius: 10,
    padding: 10,
  },
  comment: { gap: 4, paddingVertical: 4 },
  resolved: { opacity: 0.6 },
  head: { ...mobileType.footnote, color: c.textSubtle },
  author: { fontWeight: "500", color: c.textDefault },
  body: { ...mobileType.callout, color: c.textStrong },
  action: { ...mobileType.footnote, color: c.textDefault },
  reply: {
    alignSelf: "flex-start",
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.hairline,
    justifyContent: "center",
  },
  replyLabel: { ...mobileType.subhead, color: c.textDefault },
}));

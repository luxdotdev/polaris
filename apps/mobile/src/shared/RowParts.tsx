/**
 * A shared session's marks on the thread's rows (SS6): the prompt's byline, the Comments a Turn
 * carried as quoted cards, "N comments" under a message, and a step's Comment count.
 */
import type { Actor, Comment, CommentId } from "@polaris/protocol";
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { themedStyles, useTheme } from "../theme/index.ts";
import { CONTENT_TEXT_SCALE } from "../theme/textScale.ts";
import { messageAnchor } from "./commands.ts";
import {
  anchorPlace,
  authorName,
  bylineOf,
  commentsLine,
  messageComments,
  stepComments,
} from "./model.ts";
import type { RowSharing } from "./useSharedThread.ts";

/** A speech bubble outline, the Comment glyph. */
export const CommentGlyph = ({ size = 14 }: { readonly size?: number }) => {
  const { colours } = useTheme();

  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z"
        stroke={colours.textSubtle}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </Svg>
  );
};

export const Avatar = ({
  initials,
  size = 20,
}: {
  readonly initials: string;
  readonly size?: number;
}) => {
  const styles = useStyles();

  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initials, { fontSize: size * 0.42 }]} allowFontScaling={false}>
        {initials}
      </Text>
    </View>
  );
};

/** "LD Lucas Doell · turn 24" over a prompt: who sent the Turn. */
export const PromptByline = ({
  actor,
  turnId,
  sharing,
}: {
  readonly actor: Actor | null;
  readonly turnId: string;
  readonly sharing: RowSharing;
}) => {
  const styles = useStyles();

  if (actor === null) return null;
  const byline = bylineOf(actor, sharing.viewer);
  const number = sharing.turnNumber(turnId);

  return (
    <View style={styles.byline}>
      {byline.initials === "" ? null : <Avatar initials={byline.initials} size={18} />}
      <Text style={styles.bylineText} maxFontSizeMultiplier={CONTENT_TEXT_SCALE} numberOfLines={1}>
        {number === null ? byline.label : `${byline.label} · turn ${number}`}
      </Text>
    </View>
  );
};

/** The Comments a Turn carried, as quoted cards: author, then where. */
export const CarriedCards = ({
  ids,
  sharing,
}: {
  readonly ids: ReadonlyArray<CommentId>;
  readonly sharing: RowSharing;
}) => {
  const styles = useStyles();
  const carried = carriedComments(ids, sharing.comments);

  return carried.map((comment) => (
    <View key={comment.id} style={styles.card}>
      <Text style={styles.cardHead} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        <Text style={styles.cardAuthor}>{authorName(comment.author, sharing.viewer)}</Text>
        {` ${anchorPlace(comment, sharing.harness)}`}
      </Text>
      <Text style={styles.cardBody} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        {comment.body}
      </Text>
    </View>
  ));
};

/** The carried Comments in the Turn's order; ones the feed doesn't hold are left out. */
export const carriedComments = (
  ids: ReadonlyArray<CommentId>,
  comments: ReadonlyArray<Comment>
): ReadonlyArray<Comment> => ids.flatMap((id) => comments.filter((comment) => comment.id === id));

/** Under a message with Comments: "2 comments · Sent with turn 25", opening them. */
export const MessageCommentsLine = ({
  turnId,
  itemId,
  text,
  sharing,
}: {
  readonly turnId: string;
  readonly itemId: string;
  readonly text: string;
  readonly sharing: RowSharing;
}) => {
  const styles = useStyles();
  const on = messageComments(sharing.comments, itemId);

  if (on.length === 0) return null;

  return (
    <Pressable
      accessibilityRole="button"
      style={styles.line}
      hitSlop={6}
      onPress={() =>
        sharing.onOpen({
          kind: "message",
          messageId: itemId,
          target: { anchor: messageAnchor(turnId, itemId, text), quote: text },
        })
      }
    >
      <CommentGlyph />
      <Text style={styles.lineText} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        {commentsLine(on, sharing.turnNumber)}
      </Text>
    </Pressable>
  );
};

/** At a step's end: how many line Comments its files have, opening their threads. */
export const StepCommentCount = ({
  turnId,
  paths,
  label,
  sharing,
}: {
  readonly turnId: string;
  readonly paths: ReadonlyArray<string>;
  readonly label: string;
  readonly sharing: RowSharing | undefined;
}) => {
  const styles = useStyles();

  if (sharing === undefined || paths.length === 0) return null;
  const count = stepComments(sharing.comments, turnId, paths).length;

  if (count === 0) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count} comments on ${label}`}
      hitSlop={8}
      style={styles.count}
      onPress={() => sharing.onOpen({ kind: "step", turnId, paths, label })}
    >
      <CommentGlyph />
      <Text style={styles.countText} allowFontScaling={false}>
        {count}
      </Text>
    </Pressable>
  );
};

const useStyles = themedStyles((c) => ({
  avatar: {
    backgroundColor: c.raised,
    borderWidth: 1,
    borderColor: c.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { fontFamily: mobileFont.sans, fontWeight: "500", color: c.textDefault },
  byline: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 6,
    marginHorizontal: 4,
  },
  bylineText: { ...mobileType.index, color: c.textSubtle },
  card: {
    alignSelf: "stretch",
    backgroundColor: c.panel,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 2,
  },
  cardHead: { ...mobileType.footnote, color: c.textSubtle },
  cardAuthor: { fontWeight: "500", color: c.textDefault },
  cardBody: { ...mobileType.callout, color: c.textStrong },
  line: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  lineText: { ...mobileType.footnote, color: c.textSubtle },
  count: { flexDirection: "row", alignItems: "center", gap: 3 },
  countText: { ...mobileType.index, color: c.textSubtle },
}));

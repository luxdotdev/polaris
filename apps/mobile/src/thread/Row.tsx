/** One row of the thread (M4): a message, a numbered tool step, or a run of them. */
import type { Attachment } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Thumbnails } from "../attachments/index.ts";
import { Markdown } from "../markdown/index.ts";
import { themedStyles } from "../theme/index.ts";
import type { ThreadRow } from "./rows.ts";

/** The Critical diamond: an 8pt square turned 45°. */
export const Diamond = () => {
  const styles = useStyles();

  return <View style={styles.diamond} />;
};

/** Finished calls folded into one line (DESIGN.md, Tool runs): a faint check, the summary, a chevron. */
const Run = ({
  row,
  onToggle,
}: {
  readonly row: Extract<ThreadRow, { kind: "run" }>;
  readonly onToggle: (key: string) => void;
}) => {
  const styles = useStyles();

  return (
    <Pressable
      style={[styles.step, row.last && !row.open ? styles.stepLast : null]}
      onPress={() => onToggle(row.key)}
      accessibilityRole="button"
      accessibilityState={{ expanded: row.open }}
      accessibilityLabel={row.summary}
    >
      <Text style={styles.runCheck}>✓</Text>
      <Text style={styles.runSummary} numberOfLines={1}>
        {row.summary}
      </Text>
      <Text style={[styles.runChevron, row.open ? styles.runChevronOpen : null]}>›</Text>
    </Pressable>
  );
};

/** What a tapped step or finding puts in focus, for the iPhone Duo's second half (D6). */
export interface ThreadFocus {
  readonly key: string;
  readonly turnId: string;
  readonly kind: "step" | "finding";
  readonly label: string;
  readonly paths: ReadonlyArray<string>;
}

const Step = ({
  row,
  critical,
  focused,
  onFocus,
}: {
  readonly row: Extract<ThreadRow, { kind: "step" }>;
  readonly critical: boolean;
  readonly focused: boolean;
  readonly onFocus: ((focus: ThreadFocus) => void) | undefined;
}) => {
  const styles = useStyles();

  return (
    <Pressable
      disabled={onFocus === undefined}
      onPress={() =>
        onFocus?.({
          key: row.key,
          turnId: row.turnId,
          kind: "step",
          label: row.label,
          paths: row.paths,
        })
      }
      accessibilityRole={onFocus === undefined ? undefined : "button"}
      accessibilityState={onFocus === undefined ? undefined : { selected: focused }}
      style={[styles.step, row.last ? styles.stepLast : null, focused ? styles.stepFocused : null]}
    >
      <Text style={styles.stepIndex}>{row.index}</Text>
      <Text
        style={[styles.stepLabel, row.tone === "active" ? styles.stepActive : null]}
        numberOfLines={1}
      >
        {row.label}
      </Text>
      {critical ? <Diamond /> : null}
      {row.detail === "" ? null : (
        <Text style={row.tone === "failed" ? styles.stepFailed : styles.stepDetail}>
          {row.detail}
        </Text>
      )}
    </Pressable>
  );
};

export interface RowProps {
  readonly row: ThreadRow;
  /** Paths an open Critical finding is in. */
  readonly criticalPaths: ReadonlySet<string>;
  /** Opens or folds a run, by its key. */
  readonly onToggle: (key: string) => void;
  /** Makes step rows pressable; the iPhone Duo's second half follows them. */
  readonly onFocus?: ((focus: ThreadFocus) => void) | undefined;
  readonly focused?: boolean;
  /** Takes a steer that didn't land back into the composer, by its id. */
  readonly onEditSteer?: ((id: string) => void) | undefined;
  /** The session's Host, which holds the images its messages carried. */
  readonly hostId: string;
}

const Bubble = ({
  text,
  note,
  hostId,
  attachments = [],
  faded = false,
  failed = false,
}: {
  readonly text: string;
  readonly note: string | null;
  readonly hostId: string;
  readonly attachments?: ReadonlyArray<Attachment>;
  readonly faded?: boolean;
  readonly failed?: boolean;
}) => {
  const styles = useStyles();

  return (
    <View style={[styles.promptLine, faded ? styles.faded : null]}>
      <Thumbnails hostId={hostId} attachments={attachments} />
      {text.trim() === "" ? null : (
        <View style={styles.prompt}>
          <Text style={styles.message} selectable>
            {text}
          </Text>
        </View>
      )}
      {note === null ? null : (
        <Text style={[styles.note, failed ? styles.noteFailed : null]}>{note}</Text>
      )}
    </View>
  );
};

const RowView = ({
  row,
  criticalPaths,
  onToggle,
  onFocus,
  focused = false,
  onEditSteer,
  hostId,
}: RowProps) => {
  const styles = useStyles();

  switch (row.kind) {
    case "prompt":
      return <Bubble text={row.text} note={null} hostId={hostId} attachments={row.attachments} />;
    case "steered":
      return <Bubble text={row.text} note="Steered this turn" hostId={hostId} />;
    case "outgoing":
      return row.failed ? (
        <Pressable
          onPress={() => onEditSteer?.(row.id)}
          accessibilityRole="button"
          accessibilityHint="Puts the message back in the composer"
        >
          <Bubble text={row.text} note={row.note} hostId={hostId} faded failed />
        </Pressable>
      ) : (
        <Bubble
          text={row.text}
          note={row.note}
          hostId={hostId}
          attachments={row.attachments}
          faded
        />
      );
    case "reply":
      return <Markdown text={row.text} style={styles.reply} />;
    case "error":
      return <Text style={[styles.message, styles.error]}>{row.text}</Text>;
    case "run":
      return <Run row={row} onToggle={onToggle} />;
    case "step":
      return (
        <Step
          row={row}
          critical={row.paths.some((path) => criticalPaths.has(path))}
          focused={focused}
          onFocus={onFocus}
        />
      );
  }
};

export const Row = memo(RowView);

const useStyles = themedStyles((colours) => ({
  diamond: {
    width: 6,
    height: 6,
    margin: 1,
    backgroundColor: colours.severityCritical,
    transform: [{ rotate: "45deg" }],
  },
  promptLine: { alignItems: "flex-end", gap: 4, marginBottom: 12 },
  faded: { opacity: 0.6 },
  note: { ...mobileType.footnote, color: colours.textSubtle, marginHorizontal: 4 },
  noteFailed: { color: colours.failedText },
  prompt: {
    backgroundColor: colours.raised,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
    maxWidth: "88%",
  },
  message: { ...mobileType.callout, color: colours.textDefault },
  reply: { marginBottom: 12 },
  error: { color: colours.failedText, marginBottom: 12 },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 38,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colours.hairline,
  },
  stepLast: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colours.hairline,
    marginBottom: 12,
  },
  stepFocused: {
    backgroundColor: colours.raised,
    borderRadius: 10,
    borderLeftWidth: 2,
    borderLeftColor: colours.starlight,
  },
  stepIndex: { ...mobileType.index, color: colours.textFaint, width: 20 },
  stepLabel: { ...mobileType.subhead, color: colours.textSubtle, flex: 1 },
  stepActive: { color: colours.textDefault, fontWeight: "500" },
  stepDetail: { ...mobileType.footnote, color: colours.textFaint },
  stepFailed: { ...mobileType.footnote, color: colours.failedText },
  runCheck: { ...mobileType.index, color: colours.textFaint, width: 20 },
  runSummary: { ...mobileType.footnote, color: colours.textSubtle, flex: 1 },
  runChevron: { ...mobileType.subhead, color: colours.textFaint },
  runChevronOpen: { transform: [{ rotate: "90deg" }] },
}));

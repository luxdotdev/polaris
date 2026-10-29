/**
 * Ask the reviewer (Paper MX-S): a sheet thread scoped to one finding. Questions go to the
 * reviewer's own read-only session; its answers stream back under "Reviewer". The foot keeps
 * "Ask {harness} to fix" and "Not a problem…" in reach.
 */
import type { RiskFinding, VerdictReason } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Markdown } from "../../markdown/index.ts";
import { haptics } from "../../motion/index.ts";
import { InstrumentSheet, SheetHeader, StatusFooter } from "../../sheet/index.tsx";
import { themedStyles, useTheme } from "../../theme/index.ts";
import { CONTENT_TEXT_SCALE, CONTROL_TEXT_SCALE } from "../../theme/textScale.ts";
import { findingMeta, VERDICT_REASONS } from "../copy.ts";
import type { Answer } from "../ReviewScreen/answer.ts";
import type { AskEntry } from "../ReviewScreen/useAsks.ts";
import { SeverityGlyph } from "../severity.tsx";

export interface AskSheetProps {
  /** The finding asked about; null keeps the sheet closed. */
  readonly finding: RiskFinding | null;
  /** "Turn 24 · read 3 files at 9be04d". */
  readonly caption: string;
  /** This finding's questions, oldest first. */
  readonly asks: ReadonlyArray<AskEntry>;
  /** Why a question can't go now, in the placeholder; null when it can. */
  readonly blocked: string | null;
  readonly harnessName: string;
  readonly fixSent: boolean;
  readonly onAsk: (finding: RiskFinding, question: string) => void;
  readonly onAskToFix: (finding: RiskFinding) => void;
  readonly onVerdict: (finding: RiskFinding, reason: VerdictReason) => void;
  readonly onClose: () => void;
}

const Sparkle = ({ colour }: { readonly colour: string }) => (
  <Svg width={18} height={18} viewBox="0 0 18 18">
    <Path d="M9 1.5l1.6 5.9 5.9 1.6-5.9 1.6L9 16.5l-1.6-5.9L1.5 9l5.9-1.6z" fill={colour} />
  </Svg>
);

const Up = ({ colour }: { readonly colour: string }) => (
  <Svg width={14} height={14} viewBox="0 0 14 14">
    <Path
      d="M7 12V2M2.5 6.5L7 2l4.5 4.5"
      fill="none"
      stroke={colour}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const Reply = ({ answer }: { readonly answer: Answer }) => {
  const styles = useStyles();

  if (answer.kind === "answered") return <Markdown text={answer.text} />;

  if (answer.kind === "failed")
    return (
      <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.failed}>
        {answer.text}
      </Text>
    );

  return (
    <View style={styles.thinking}>
      <View style={styles.dot} />
      <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.step} numberOfLines={2}>
        {answer.step === null ? "Reading…" : `${answer.step}…`}
      </Text>
    </View>
  );
};

const Exchange = ({ ask }: { readonly ask: AskEntry }) => {
  const styles = useStyles();

  return (
    <View style={styles.exchange}>
      <View style={styles.questionRow}>
        <View style={styles.bubble}>
          <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.question}>
            {ask.question}
          </Text>
        </View>
      </View>
      <View style={styles.answer}>
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.kicker}>
          REVIEWER
        </Text>
        <Reply answer={ask.answer} />
      </View>
    </View>
  );
};

const FindingWell = ({ finding }: { readonly finding: RiskFinding }) => {
  const styles = useStyles();

  return (
    <View style={styles.finding}>
      <View style={styles.findingRow}>
        <SeverityGlyph severity={finding.severity} size={8} />
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.findingTitle}>
          {finding.title}
        </Text>
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.meta}>
          {findingMeta(finding)}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.place}>
        {`${finding.path}:${finding.lines.start}`}
      </Text>
    </View>
  );
};

const Chip = ({ label, onPress }: { readonly label: string; readonly onPress: () => void }) => {
  const styles = useStyles();

  return (
    <Pressable accessibilityRole="button" style={styles.chip} onPress={onPress}>
      <Text maxFontSizeMultiplier={CONTROL_TEXT_SCALE} numberOfLines={1} style={styles.chipText}>
        {label}
      </Text>
    </Pressable>
  );
};

const Composer = (props: AskSheetProps & { readonly finding: RiskFinding }) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const [text, setText] = useState("");
  const [judging, setJudging] = useState(false);
  const ready = props.blocked === null && text.trim() !== "";
  const { finding } = props;

  const send = () => {
    if (!ready) return;
    haptics.send();
    props.onAsk(finding, text);
    setText("");
  };

  return (
    <View style={styles.composer}>
      <View style={styles.chips}>
        {judging ? (
          VERDICT_REASONS.map(({ reason, label }) => (
            <Chip key={reason} label={label} onPress={() => props.onVerdict(finding, reason)} />
          ))
        ) : (
          <>
            {props.fixSent ? null : (
              <Chip
                label={`Ask ${props.harnessName} to fix`}
                onPress={() => props.onAskToFix(finding)}
              />
            )}
            <Chip label="Not a problem…" onPress={() => setJudging(true)} />
          </>
        )}
      </View>
      <View style={styles.field}>
        <TextInput
          accessibilityLabel="Ask the reviewer"
          editable={props.blocked === null}
          maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={props.blocked ?? "Ask about this finding"}
          placeholderTextColor={colours.textFaint}
          returnKeyType="send"
          onSubmitEditing={send}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ask"
          accessibilityState={{ disabled: !ready }}
          disabled={!ready}
          style={[styles.send, !ready && styles.sendOff]}
          onPress={send}
        >
          <Up colour={ready ? colours.ground : colours.textFaint} />
        </Pressable>
      </View>
    </View>
  );
};

export const AskSheet = (props: AskSheetProps) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const { finding } = props;

  return (
    <InstrumentSheet open={finding !== null} onClose={props.onClose} detents={["large"]}>
      <SheetHeader
        title="Ask the reviewer"
        mark={
          <View style={styles.markTile}>
            <Sparkle colour={colours.textDefault} />
          </View>
        }
        onClose={props.onClose}
      />
      <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.caption}>
        {props.caption}
      </Text>
      {finding === null ? null : <FindingWell finding={finding} />}
      {props.asks.map((ask) => (
        <Exchange key={ask.id} ask={ask} />
      ))}
      {finding === null ? null : (
        <StatusFooter>
          <Composer {...props} finding={finding} />
        </StatusFooter>
      )}
    </InstrumentSheet>
  );
};

const useStyles = themedStyles((colours) => ({
  markTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  caption: { ...mobileType.footnote, color: colours.textSubtle, paddingHorizontal: 8 },
  finding: {
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.well,
  },
  findingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  findingTitle: { ...mobileType.label, lineHeight: 20, flex: 1, color: colours.textStrong },
  meta: { ...mobileType.index, fontSize: 11, color: colours.textSubtle },
  place: { ...mobileType.index, lineHeight: 17, paddingLeft: 16, color: colours.textFaint },
  exchange: { gap: 14, paddingTop: 4 },
  questionRow: { flexDirection: "row", justifyContent: "flex-end" },
  bubble: {
    maxWidth: "80%",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 6,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.raised,
  },
  question: { ...mobileType.callout, color: colours.textStrong },
  answer: { gap: 8, paddingRight: 24 },
  kicker: {
    ...mobileType.index,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 0.9,
    color: colours.textSubtle,
  },
  thinking: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colours.textSubtle },
  step: { ...mobileType.subhead, lineHeight: 20, flex: 1, color: colours.textFaint },
  failed: { ...mobileType.subhead, color: colours.failedText },
  composer: { flex: 1, gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.raised,
  },
  chipText: { ...mobileType.footnote, fontWeight: "500", color: colours.textDefault },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingLeft: 16,
    paddingRight: 6,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.raised,
  },
  input: { ...mobileType.callout, flex: 1, minHeight: 34, color: colours.textDefault },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.starlight,
  },
  sendOff: { backgroundColor: colours.well },
}));

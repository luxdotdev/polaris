/**
 * The span's second half (Paper MX-AG): the chosen task, its claim, checks and head, the other
 * claims waiting, and Send back / Accept, which open the one-line reply to the lead.
 */
import { mobileFont, mobileType, mobileWeight } from "@polaris/ui/tokens";
import { Pressable, ScrollView, Text, View } from "react-native";
import { HandedClaimActions, type SendVerdict } from "../constellation/claim.tsx";
import type { Check, TaskRow } from "../constellation/model.ts";
import type { Delivery } from "../constellation/outbox.ts";
import { chosen, claimKey, type Unsent, unsentFor } from "../constellation/unsent.ts";
import { haptics } from "../motion/index.ts";
import { CONTENT_TEXT_SCALE, CONTROL_TEXT_SCALE } from "../theme/textScale.ts";
import { themedStyles, useTheme } from "../theme/index.ts";
import type { ClaimPane as Pane } from "./span.ts";

const EDGE = "#ffffff1f";

/** What the pane needs to send a verdict on the chosen task's handed claim. */
export interface PaneVerdicts {
  readonly delivery: Delivery | null;
  readonly send: SendVerdict;
  readonly cancel: () => void;
  readonly unsent: Unsent | null;
  readonly onUnsent: (next: Unsent) => void;
}

const MARK: Readonly<Record<Check["result"], string>> = { passed: "✓", failed: "✗", reported: "·" };

const CheckLine = ({ check }: { readonly check: Check }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  const colour = {
    passed: colours.diffAddedText,
    failed: colours.failedText,
    reported: colours.textSubtle,
  }[check.result];

  return (
    <View style={styles.check}>
      <Text style={[styles.mark, { color: colour }]}>{MARK[check.result]}</Text>
      <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.checkLabel} numberOfLines={2}>
        {check.label}
      </Text>
    </View>
  );
};

const Pill = ({ pill }: { readonly pill: Pane["pill"] }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  const [fill, ink] = {
    "needs-you": [colours.needsYouFill, colours.needsYouText],
    failed: [colours.failedFill, colours.failedText],
    quiet: [colours.raised, colours.textSubtle],
  }[pill.tone];

  return (
    <View style={[styles.pill, { backgroundColor: fill }]}>
      <View style={[styles.pillDot, { backgroundColor: ink }]} />
      <Text maxFontSizeMultiplier={CONTROL_TEXT_SCALE} style={[styles.pillText, { color: ink }]}>
        {pill.text}
      </Text>
    </View>
  );
};

const Actions = ({ row, verdicts }: { readonly row: TaskRow; readonly verdicts: PaneVerdicts }) => {
  const styles = useStyles();
  const handed = row.handed;

  const send: SendVerdict = (verdict, reply) => {
    if (verdict === "accept") haptics.approve();
    verdicts.send(verdict, reply);
  };

  if (handed === null && verdicts.delivery === null) return null;

  const key = handed === null ? "" : claimKey(handed);

  const choosing =
    verdicts.delivery === null && unsentFor(verdicts.unsent, key).step.kind === "choose";

  if (!choosing || handed === null)
    return (
      <HandedClaimActions
        claim={handed}
        delivery={verdicts.delivery}
        onVerdict={send}
        onCancel={verdicts.cancel}
        unsent={verdicts.unsent}
        onUnsent={verdicts.onUnsent}
        bare
      />
    );

  return (
    <View style={styles.buttons}>
      <Pressable
        accessibilityRole="button"
        onPress={() => verdicts.onUnsent(chosen(key, "send-back"))}
        style={({ pressed }) => [styles.button, styles.sendBack, pressed ? styles.pressed : null]}
      >
        <Text
          maxFontSizeMultiplier={CONTROL_TEXT_SCALE}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          style={styles.sendBackLabel}
        >
          Send back…
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => verdicts.onUnsent(chosen(key, "accept"))}
        style={({ pressed }) => [styles.button, styles.accept, pressed ? styles.pressed : null]}
      >
        <Text
          maxFontSizeMultiplier={CONTROL_TEXT_SCALE}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          style={styles.acceptLabel}
        >
          Accept
        </Text>
      </Pressable>
    </View>
  );
};

export interface ClaimPaneProps {
  readonly pane: Pane | null;
  readonly row: TaskRow | null;
  readonly verdicts: PaneVerdicts | null;
  readonly onChoose: (taskId: string) => void;
  /** The pane's width once clear of the window's insets; a narrow pane lays out tighter. */
  readonly width: number;
}

const ClaimBody = ({ claim }: { readonly claim: NonNullable<Pane["claim"]> }) => {
  const styles = useStyles();

  return (
    <>
      <View style={styles.claim}>
        {claim.summary === "" ? null : (
          <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.summary} numberOfLines={8}>
            {claim.summary}
          </Text>
        )}
        {claim.checks.length === 0 ? null : (
          <View style={[styles.checks, claim.summary === "" ? null : styles.divided]}>
            {claim.checks.map((check) => (
              <CheckLine key={check.label} check={check} />
            ))}
          </View>
        )}
      </View>
      <View style={styles.headWell}>
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.headText}>
          {claim.head}
        </Text>
      </View>
    </>
  );
};

/** Below this the pane takes the narrow layout: tighter margins and a smaller title. */
const NARROW = 300;

export const ClaimPane = ({ pane, row, verdicts, onChoose, width }: ClaimPaneProps) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const narrow = width < NARROW;

  if (pane === null || row === null)
    return (
      <View style={[styles.pane, styles.empty]}>
        <Text style={styles.emptyText}>Tap a star, and its task shows here.</Text>
      </View>
    );

  const [next] = pane.others;

  return (
    <View style={styles.pane}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.content, narrow ? styles.narrowSides : null]}
      >
        <View style={[styles.head, narrow ? styles.narrowHead : null]}>
          <Text maxFontSizeMultiplier={CONTROL_TEXT_SCALE} style={styles.kicker} numberOfLines={1}>
            {pane.kicker}
          </Text>
          <Pill pill={pane.pill} />
        </View>
        <Text
          maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
          style={[styles.title, narrow ? styles.narrowTitle : null]}
        >
          {pane.title}
        </Text>
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.meta}>
          {pane.meta}
        </Text>
        {pane.claim === null ? null : <ClaimBody claim={pane.claim} />}
        {row.handed?.question == null ? null : (
          <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.question}>
            <Text style={{ color: colours.needsYouText }}>Asks · </Text>
            {row.handed.question}
          </Text>
        )}
      </ScrollView>
      <View style={[styles.foot, narrow ? styles.narrowSides : null]}>
        {next === undefined ? null : (
          <Pressable accessibilityRole="button" onPress={() => onChoose(next.id)} hitSlop={8}>
            <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.next}>
              {next.label} has a claim waiting too · Next ›
            </Text>
          </Pressable>
        )}
        {verdicts === null ? null : <Actions row={row} verdicts={verdicts} />}
      </View>
    </View>
  );
};

const sans = (fontSize: number, lineHeight: number, medium = false) => ({
  fontFamily: mobileFont.sans,
  fontSize,
  lineHeight,
  fontWeight: medium ? mobileWeight.medium : mobileWeight.regular,
});

const mono = (fontSize: number, lineHeight: number) => ({
  fontFamily: mobileFont.mono,
  fontSize,
  lineHeight,
});

const useStyles = themedStyles((c) => ({
  pane: { flex: 1, backgroundColor: c.panel },
  fill: { flex: 1 },
  content: { gap: 14, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  empty: { justifyContent: "center", padding: 40 },
  emptyText: { ...mobileType.callout, color: c.textFaint, textAlign: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  kicker: {
    ...mono(11, 14),
    flexGrow: 1,
    flexShrink: 1,
    fontWeight: mobileWeight.medium,
    letterSpacing: 0.88,
    textTransform: "uppercase",
    color: c.textSubtle,
  },
  pill: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: sans(12, 16, true),
  title: { ...sans(20, 26, true), color: c.textStrong },
  narrowTitle: sans(17, 22, true),
  narrowSides: { paddingHorizontal: 14 },
  narrowHead: { flexDirection: "column", alignItems: "flex-start", gap: 8 },
  meta: { ...sans(13, 18), marginTop: -6, color: c.textSubtle },
  claim: {
    gap: 8,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.hairline,
    backgroundColor: c.raised,
  },
  summary: { ...sans(14, 20), color: c.textDefault },
  checks: { gap: 6 },
  divided: { paddingTop: 6, borderTopWidth: 1, borderTopColor: c.hairline },
  check: { flexDirection: "row", alignItems: "center", gap: 8 },
  mark: { ...sans(13, 18), width: 14 },
  checkLabel: { ...mono(12, 18), flex: 1, color: c.textDefault },
  headWell: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.hairline,
    backgroundColor: c.well,
  },
  headText: { ...mono(12, 16), color: c.textSubtle },
  question: { ...sans(14, 20), color: c.textDefault },
  foot: { gap: 14, paddingHorizontal: 20, paddingBottom: 24 },
  next: { ...sans(12, 16), color: c.textFaint },
  /** Side by side when both fit at their label size; stacked full width when not. */
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  button: {
    flexGrow: 1,
    flexBasis: 128,
    minHeight: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  sendBack: { borderWidth: 1, borderColor: EDGE, backgroundColor: c.raised },
  accept: { backgroundColor: c.textStrong },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  sendBackLabel: { ...mobileType.label, color: c.textDefault },
  acceptLabel: { ...mobileType.label, color: c.panel },
}));

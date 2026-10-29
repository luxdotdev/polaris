/**
 * A claim the lead handed to the user (Paper C2, B2): its question, Accept and Send back.
 * Either opens a one-line reply; sending it records the verdict and tells the lead (Q27).
 */
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { haptics } from "../motion/index.ts";
import { InstrumentSheet } from "../sheet/index.tsx";
import { themedStyles, useTheme } from "../theme/index.ts";
import { CONTENT_TEXT_SCALE } from "../theme/textScale.ts";
import { type ClaimCheck, type ClaimDetail, claimDetail, claimStep } from "./claimSheet.ts";
import type { Check, ConstellationSource, HandedClaim } from "./model.ts";
import { cancellable, type Delivery, deliveryLine, editable } from "./outbox.ts";
import { chosen, claimKey, fresh, typed, type Unsent, unsentFor } from "./unsent.ts";
import { Kicker, SheetHead } from "./stats/parts.tsx";
import type { Verdicts } from "./useVerdicts.ts";
import { canSend, type Verdict } from "./verdict.ts";

export type SendVerdict = (verdict: Verdict, reply: string) => void;

const PLACEHOLDER: Readonly<Record<Verdict, string>> = {
  accept: "Your answer for the lead",
  "send-back": "What should change?",
};

const SEND: Readonly<Record<Verdict, string>> = { accept: "Accept", "send-back": "Send back" };

const HINT: Readonly<Record<Verdict, string>> = {
  accept: "Approves the claim and tells the lead to merge it.",
  "send-back": "Tells the lead to send it back with your answer.",
};

const MARK: Readonly<Record<Check["result"], string>> = { passed: "✓", failed: "✗", reported: "·" };

export const Checks = ({ head, checks }: Pick<HandedClaim, "head" | "checks">) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <View style={styles.checks}>
      <Text style={styles.sha}>{head}</Text>
      {checks.map((check) => (
        <Text
          key={check.label}
          style={[
            styles.meta,
            check.result === "passed" && { color: colours.acceptedText },
            check.result === "failed" && { color: colours.failedText },
          ]}
        >
          {MARK[check.result]} <Text style={styles.meta}>{check.label}</Text>
        </Text>
      ))}
    </View>
  );
};

const Choose = ({ onChoose }: { readonly onChoose: (verdict: Verdict) => void }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <>
      <View style={styles.buttons}>
        <Pressable
          accessibilityRole="button"
          style={[styles.button, styles.primary]}
          onPress={() => onChoose("accept")}
        >
          <Text style={[styles.label, { color: colours.ground }]}>Accept</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={[styles.button, styles.secondary]}
          onPress={() => onChoose("send-back")}
        >
          <Text style={[styles.label, { color: colours.textDefault }]}>Send back</Text>
        </Pressable>
      </View>
      <Text style={styles.caption}>Either one asks for your answer, then tells the lead.</Text>
    </>
  );
};

const Reply = ({
  verdict,
  delivery,
  typedDraft,
  onDraft,
  onSend,
  onCancel,
}: {
  readonly verdict: Verdict;
  readonly delivery: Delivery | null;
  readonly typedDraft: string | null;
  readonly onDraft: (draft: string) => void;
  readonly onSend: (reply: string) => void;
  readonly onCancel: () => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const draft = typedDraft ?? delivery?.input.reply ?? "";
  const open = editable(delivery);
  const sending = delivery?.state === "sending";
  // A lost step is retried as it was sent, so its answer stays as the Host may have it.
  const text = open ? draft : (delivery?.input.reply ?? draft);
  const ready = !sending && canSend(verdict, text);
  const failed = delivery?.state === "failed";
  const label = failed && !open ? "Retry" : SEND[verdict];

  return (
    <View style={styles.reply}>
      <View style={styles.field}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={onDraft}
          placeholder={PLACEHOLDER[verdict]}
          placeholderTextColor={colours.textFaint}
          autoFocus={delivery === null}
          editable={open}
          returnKeyType="send"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={() => ready && onSend(text)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          disabled={!ready}
          style={[styles.send, ready ? styles.primary : styles.sendOff]}
          onPress={() => onSend(text)}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colours.ground} />
          ) : (
            <Text style={[styles.label, { color: ready ? colours.ground : colours.textFaint }]}>
              {label}
            </Text>
          )}
        </Pressable>
      </View>
      <View style={styles.replyFoot}>
        <Text style={[styles.caption, failed && { color: colours.failedText }]}>
          {delivery === null ? HINT[verdict] : deliveryLine(delivery)}
        </Text>
        {cancellable(delivery) ? (
          <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8}>
            <Text style={styles.caption}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

/**
 * The claim's verdict: choose, answer, then its delivery from the outbox. A delivery stays
 * here after the claim leaves the user (Accept approved it), until the lead has the answer.
 * The unsent choice and answer belong to one claim; pass `unsent` to keep them outside.
 */
export const HandedClaimActions = ({
  claim,
  delivery,
  onVerdict,
  onCancel,
  unsent: controlled,
  onUnsent,
}: {
  readonly claim: HandedClaim | null;
  readonly delivery: Delivery | null;
  readonly onVerdict: SendVerdict;
  readonly onCancel: () => void;
  readonly unsent?: Unsent | null;
  readonly onUnsent?: (next: Unsent) => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const [local, setLocal] = useState<Unsent | null>(null);
  const ref = claim ?? delivery?.input ?? null;
  const key = ref === null ? "" : claimKey(ref);
  const unsent = unsentFor(controlled === undefined ? local : controlled, key);
  const update = (next: Unsent) => (onUnsent === undefined ? setLocal(next) : onUnsent(next));
  const step = unsent.step;
  const verdict = delivery?.input.verdict ?? (step.kind === "reply" ? step.verdict : null);

  return (
    <View style={styles.claim}>
      {claim === null ? null : <Checks head={claim.head} checks={claim.checks} />}
      {claim?.question == null ? null : (
        <Text style={styles.question}>
          <Text style={{ color: colours.needsYouText }}>Asks · </Text>
          {claim.question}
        </Text>
      )}
      {delivery?.state === "delivered" ? (
        <Text style={[styles.caption, { color: colours.acceptedText }]}>
          {deliveryLine(delivery)}
        </Text>
      ) : verdict === null ? (
        <Choose onChoose={(choice) => update(chosen(key, choice))} />
      ) : (
        <Reply
          verdict={verdict}
          delivery={delivery}
          typedDraft={unsent.draft}
          onDraft={(draft) => update(typed(unsent, draft))}
          onSend={(reply) => onVerdict(verdict, reply)}
          onCancel={() => {
            onCancel();
            update(fresh(key));
          }}
        />
      )}
    </View>
  );
};

const CheckGlyph = ({ result }: { readonly result: Check["result"] }) => {
  const { colours } = useTheme();

  if (result === "reported")
    return <Text style={{ color: colours.textSubtle, width: 12 }}>{MARK.reported}</Text>;

  return (
    <Svg width={12} height={12} viewBox="0 0 12 12">
      <Path
        d={result === "passed" ? "M2 6.5l2.5 2.5L10 3" : "M3 3l6 6M9 3l-6 6"}
        fill="none"
        stroke={result === "passed" ? colours.diffAddedText : colours.failedText}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
};

const CheckWell = ({ checks }: { readonly checks: ReadonlyArray<ClaimCheck> }) => {
  const styles = useSheetStyles();

  if (checks.length === 0) return null;

  return (
    <View style={styles.checks}>
      {checks.map((check, i) => (
        <View key={check.label} style={[styles.check, i > 0 && styles.ruled]}>
          <CheckGlyph result={check.result} />
          <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.checkLabel}>
            {check.label}
          </Text>
          {check.detail === null ? null : <Text style={styles.detail}>{check.detail}</Text>}
        </View>
      ))}
    </View>
  );
};

const HeadLine = ({
  detail,
  onOpenDiff,
}: {
  readonly detail: ClaimDetail;
  readonly onOpenDiff: (() => void) | undefined;
}) => {
  const styles = useSheetStyles();

  return (
    <View style={styles.headLine}>
      <View style={styles.headText}>
        <Text style={styles.sha}>head {detail.head}</Text>
        <Text numberOfLines={1} style={styles.branch}>
          {detail.branch}
        </Text>
      </View>
      {onOpenDiff === undefined ? null : (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onOpenDiff}>
          <Text style={styles.link}>Open diff ›</Text>
        </Pressable>
      )}
    </View>
  );
};

const VerdictButtons = ({
  onSendBack,
  onAccept,
}: {
  readonly onSendBack: () => void;
  readonly onAccept: () => void;
}) => {
  const styles = useSheetStyles();

  return (
    <View style={styles.verdicts}>
      <Pressable
        accessibilityRole="button"
        onPress={onSendBack}
        style={({ pressed }) => [styles.big, styles.bigSecondary, pressed && styles.pressed]}
      >
        <Text style={[styles.bigLabel, styles.bigSecondaryLabel]}>Send back…</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onAccept}
        style={({ pressed }) => [styles.big, styles.bigPrimary, pressed && styles.pressed]}
      >
        <Text style={[styles.bigLabel, styles.bigPrimaryLabel]}>Accept</Text>
      </Pressable>
    </View>
  );
};

const Foot = ({
  detail,
  verdicts,
}: {
  readonly detail: ClaimDetail;
  readonly verdicts: Verdicts;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const [askingReason, setAskingReason] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const delivery = verdicts.find(detail.row);
  const send = verdicts.send(detail.row);
  const step = claimStep(detail, delivery, askingReason);

  const accept = () => {
    haptics.approve();
    send("accept", "");
  };

  switch (step) {
    case "read-only":
      return <Text style={styles.caption}>The lead is reviewing this claim.</Text>;
    case "delivered":
      return (
        <Text style={[styles.caption, { color: colours.acceptedText }]}>
          {delivery === null ? "" : deliveryLine(delivery)}
        </Text>
      );
    case "choose":
      return <VerdictButtons onSendBack={() => setAskingReason(true)} onAccept={accept} />;
    default:
      return (
        <Reply
          verdict={delivery?.input.verdict ?? "send-back"}
          delivery={delivery}
          typedDraft={draft}
          onDraft={setDraft}
          onSend={(reply) => {
            haptics.send();
            send(delivery?.input.verdict ?? "send-back", reply);
          }}
          onCancel={() => {
            verdicts.cancel(detail.row);
            setAskingReason(false);
            setDraft(null);
          }}
        />
      );
  }
};

export interface ClaimSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly taskId: string | null;
  readonly source: ConstellationSource;
  /** The screen's `useVerdicts`, so the sheet and the rail share one outbox. */
  readonly verdicts: Verdicts;
  readonly now: number;
  /** Opens the claim's diff; the link shows only when given. */
  readonly onOpenDiff?: () => void;
}

/**
 * The claim sheet (Paper MX-AA): the claim, its checks and head. Accept fires the success
 * haptic and tells the lead at once; Send back asks for the reason first.
 */
export const ClaimSheet = ({
  open,
  onClose,
  taskId,
  source,
  verdicts,
  now,
  onOpenDiff,
}: ClaimSheetProps) => {
  const styles = useSheetStyles();
  const { colours } = useTheme();

  const detail = useMemo(
    () => (taskId === null ? null : claimDetail(source, taskId, now)),
    [source, taskId, now]
  );

  return (
    <InstrumentSheet open={open && detail !== null} onClose={onClose} detents={["large"]}>
      {detail === null ? null : (
        <View style={styles.body}>
          <SheetHead onClose={onClose}>
            <Kicker
              text={`Claim · ${detail.taskId} · attempt ${detail.attempt}`}
              dot={detail.row.handed === null ? colours.textFaint : colours.needsYou}
            />
            <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.title}>
              {detail.title}
            </Text>
          </SheetHead>
          {detail.summary === "" ? null : (
            <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.summary}>
              {detail.summary}
            </Text>
          )}
          <CheckWell checks={detail.checks} />
          <HeadLine detail={detail} onOpenDiff={onOpenDiff} />
          <Foot
            key={detail.row.handed?.attemptId ?? detail.taskId}
            detail={detail}
            verdicts={verdicts}
          />
        </View>
      )}
    </InstrumentSheet>
  );
};

const useSheetStyles = themedStyles((colours) => ({
  body: { gap: 14, paddingHorizontal: 6, paddingBottom: 8 },
  title: {
    fontFamily: mobileType.title.fontFamily,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "600",
    color: colours.textStrong,
  },
  summary: { ...mobileType.callout, lineHeight: 22, color: colours.textDefault },
  checks: {
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: colours.well,
    borderColor: colours.hairline,
  },
  check: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  ruled: { borderTopWidth: 1, borderTopColor: colours.hairline },
  checkLabel: {
    flex: 1,
    fontFamily: mobileFont.mono,
    fontSize: 12,
    lineHeight: 17,
    color: colours.textDefault,
  },
  detail: { fontFamily: mobileFont.mono, fontSize: 11, lineHeight: 16, color: colours.textFaint },
  headLine: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 2 },
  headText: { flex: 1, minWidth: 0 },
  sha: { fontFamily: mobileFont.mono, fontSize: 12, lineHeight: 17, color: colours.textDefault },
  branch: { fontFamily: mobileFont.mono, fontSize: 11, lineHeight: 16, color: colours.textFaint },
  link: { ...mobileType.subhead, fontWeight: "500", color: colours.textDefault },
  verdicts: { flexDirection: "row", gap: 10 },
  big: { flex: 1, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
  bigSecondary: { backgroundColor: colours.raised, borderWidth: 1, borderColor: colours.hairline },
  bigPrimary: { backgroundColor: colours.textStrong },
  bigLabel: {
    fontFamily: mobileType.label.fontFamily,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "600",
  },
  bigSecondaryLabel: { color: colours.textDefault },
  bigPrimaryLabel: { color: colours.ground },
  pressed: { transform: [{ scale: 0.97 }] },
}));

const useStyles = themedStyles((colours) => ({
  claim: { gap: 6 },
  checks: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  sha: { ...mobileType.index, color: colours.textSubtle },
  meta: { ...mobileType.footnote, color: colours.textSubtle },
  question: { ...mobileType.callout, color: colours.textDefault },
  buttons: { flexDirection: "row", gap: 8, paddingTop: 4 },
  button: { height: 36, borderRadius: 999, justifyContent: "center", paddingHorizontal: 18 },
  primary: { backgroundColor: colours.textStrong },
  secondary: { borderWidth: 1, borderColor: colours.hairline },
  label: { ...mobileType.label },
  caption: {
    fontFamily: mobileType.footnote.fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: colours.textSubtle,
  },
  reply: { gap: 6, paddingTop: 4 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colours.well,
    borderColor: colours.hairline,
    borderWidth: 1,
    borderRadius: 18,
    paddingLeft: 14,
    paddingRight: 4,
    height: 44,
  },
  input: { ...mobileType.callout, flex: 1, color: colours.textStrong },
  send: {
    height: 34,
    borderRadius: 999,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14,
    minWidth: 72,
  },
  sendOff: { backgroundColor: colours.raised },
  replyFoot: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
}));

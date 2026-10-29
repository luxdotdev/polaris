/**
 * The composer's floating notice strip (Paper MX-E): the oldest open request with "+n" for the
 * rest, else Working. A permission shows Approve and Deny beside a command that fits one line,
 * and opens to every line (and Always here) otherwise; questions show their options and Send.
 */
import type { ApprovalDecision, ApprovalRequest, HarnessKind, RequestId } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { noticesOf, type Strip, stripOf, type StripNotice } from "../composer/strip.ts";
import { Dither } from "../dither/index.ts";
import { decisionOf } from "../home/model/respond.ts";
import { haptics } from "../motion";
import { type MobileColours, useTheme } from "../theme";
import { elapsed, harnessHue, harnessName } from "./labels.ts";
import { answered, answersDecision, pick, type Picks, requestCard } from "./requests.ts";

export interface PendingRequestsProps {
  readonly requests: ReadonlyArray<ApprovalRequest>;
  readonly answering: ReadonlyArray<RequestId>;
  readonly errors: ReadonlyMap<RequestId, string>;
  /** False while the Host isn't connected: shown, not answerable. */
  readonly enabled: boolean;
  readonly onRespond: (requestId: RequestId, decision: ApprovalDecision) => void;
}

export interface NoticeStripProps extends PendingRequestsProps {
  readonly harness: HarnessKind;
  /** When the Turn in flight started; null when none is working. */
  readonly workingSince: string | null;
}

interface CardProps {
  readonly request: ApprovalRequest;
  readonly live: boolean;
  readonly onRespond: (decision: ApprovalDecision) => void;
}

const Spark = ({ colour }: { readonly colour: string }) => (
  <Svg width={12} height={12} viewBox="0 0 12 12">
    <Path d="M6 0.5 L7.1 4.9 L11.5 6 L7.1 7.1 L6 11.5 L4.9 7.1 L0.5 6 L4.9 4.9 Z" fill={colour} />
  </Svg>
);

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

const Answer = ({
  label,
  filled,
  live,
  onPress,
}: {
  readonly label: string;
  readonly filled: boolean;
  readonly live: boolean;
  readonly onPress: () => void;
}) => {
  const { colours } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      disabled={!live}
      onPress={onPress}
      hitSlop={6}
      style={[styles.answer, filled ? { backgroundColor: colours.textStrong } : null]}
    >
      <Text style={[styles.answerLabel, { color: filled ? colours.bg : colours.textSubtle }]}>
        {label}
      </Text>
    </Pressable>
  );
};

const Permission = ({
  notice,
  card,
  open,
  onToggle,
}: {
  readonly notice: Extract<StripNotice, { kind: "approval" }>;
  readonly card: CardProps;
  readonly open: boolean;
  readonly onToggle: () => void;
}) => {
  const { colours } = useTheme();
  // A compact command that still wraps opens to the whole: Approve is never beside cut-off text.
  const [wraps, setWraps] = useState(false);
  const whole = open || !notice.compact || wraps;

  const approve = () => {
    haptics.approve();
    card.onRespond(decisionOf({ kind: "approve" }));
  };

  const buttons = (
    <>
      <Answer label="Approve" filled live={card.live} onPress={approve} />
      {whole ? (
        <Answer
          label="Always here"
          filled={false}
          live={card.live}
          onPress={() => {
            haptics.approve();
            card.onRespond(decisionOf({ kind: "always" }));
          }}
        />
      ) : null}
      <Answer
        label="Deny"
        filled={false}
        live={card.live}
        onPress={() => card.onRespond(decisionOf({ kind: "deny" }))}
      />
    </>
  );

  return (
    <View style={[styles.column, card.live ? null : styles.waiting]}>
      <View style={styles.row}>
        <Spark colour={colours.needsYou} />
        <Pressable
          style={styles.text}
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={`${notice.headline}${notice.detail === null ? "" : `: ${notice.detail}`}`}
          accessibilityHint={whole ? undefined : "Shows the whole request"}
        >
          <Text style={[styles.headline, { color: colours.needsYouText }]}>{notice.headline}</Text>
          {notice.detail === null || whole ? null : (
            <Text
              style={[styles.detail, { color: colours.textDefault }]}
              onTextLayout={(event) => {
                if (event.nativeEvent.lines.length > 1) setWraps(true);
              }}
            >
              {notice.detail}
            </Text>
          )}
        </Pressable>
        {whole ? null : buttons}
      </View>
      {whole && notice.detail !== null ? (
        <ScrollView style={styles.whole} nestedScrollEnabled>
          <Text style={[styles.detail, { color: colours.textDefault }]} selectable>
            {notice.detail}
          </Text>
        </ScrollView>
      ) : null}
      {whole ? <View style={styles.buttons}>{buttons}</View> : null}
    </View>
  );
};

const Questions = ({ request, live, onRespond }: CardProps) => {
  const { colours } = useTheme();
  const [picks, setPicks] = useState<Picks>([]);
  const card = requestCard(request);
  const questions = card.kind === "questions" ? card.questions : [];
  const ready = live && answered(request, picks);

  return (
    <ScrollView style={styles.questions} contentContainerStyle={styles.column} nestedScrollEnabled>
      {questions.map((question, index) => (
        <View key={`${index}:${question.question}`} style={styles.question}>
          <Text style={[styles.questionText, { color: colours.textDefault }]}>
            <Text style={[styles.headline, { color: colours.needsYouText }]}>
              {question.header === "" ? "Asks · " : `${question.header} · `}
            </Text>
            {question.question}
          </Text>
          <View style={[styles.chips, live ? null : styles.waiting]}>
            {question.options.map((option) => {
              const chosen = (picks[index] ?? []).includes(option.label);

              return (
                <Pressable
                  key={option.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chosen }}
                  disabled={!live}
                  onPress={() =>
                    setPicks((held) => pick(held, index, option.label, question.multiSelect))
                  }
                  style={[
                    styles.choice,
                    chosen
                      ? { backgroundColor: colours.textStrong, borderColor: colours.textStrong }
                      : { borderColor: colours.hairline },
                  ]}
                >
                  <Text
                    style={[
                      styles.choiceLabel,
                      { color: chosen ? colours.bg : colours.textDefault },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      <View style={[styles.buttons, ready ? null : styles.waiting]}>
        <Answer
          label="Send answers"
          filled
          live={ready}
          onPress={() => {
            haptics.approve();
            onRespond(answersDecision(request, picks));
          }}
        />
      </View>
    </ScrollView>
  );
};

const Working = ({ harness, since }: { readonly harness: HarnessKind; readonly since: string }) => {
  const { colours } = useTheme();
  const time = useElapsed(since);
  const hue = harnessHue(colours, harness);

  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <Dither color={hue} size={14} moving />
      <Text style={[styles.headline, { color: hue }]}>{harnessName(harness)} is working</Text>
      <Text style={[styles.time, { color: colours.textFaint }]}>· {time}</Text>
    </View>
  );
};

const More = ({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) => {
  const { colours } = useTheme();

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={open ? "Show less" : `${count} more`}
      hitSlop={8}
      style={[styles.more, { backgroundColor: colours.fillHover }]}
    >
      <Text style={[styles.moreLabel, { color: colours.textSubtle }]}>
        {open ? "Less" : `+${count}`}
      </Text>
    </Pressable>
  );
};

const Notice = ({
  notice,
  props,
}: {
  readonly notice: StripNotice;
  readonly props: NoticeStripProps;
}) => {
  const { colours } = useTheme();
  const [open, setOpen] = useState(false);

  if (notice.kind === "working")
    return props.workingSince === null ? null : (
      <Working harness={props.harness} since={props.workingSince} />
    );
  const { request } = notice;

  const card: CardProps = {
    request,
    live: props.enabled && !props.answering.includes(request.id),
    onRespond: (decision) => props.onRespond(request.id, decision),
  };

  return (
    <View style={styles.column}>
      {notice.kind === "question" ? (
        <Questions {...card} />
      ) : (
        <Permission notice={notice} card={card} open={open} onToggle={() => setOpen(!open)} />
      )}
      {props.errors.has(request.id) ? (
        <Text style={[styles.failed, { color: colours.failedText }]}>
          Couldn't send. Try again.
        </Text>
      ) : null}
    </View>
  );
};

const panel = (colours: MobileColours) => ({
  backgroundColor: colours.raised,
  borderColor: colours.hairline,
});

/** Every request when opened, else the strip's one; nothing when there's nothing to know. */
export const PendingRequests = (props: NoticeStripProps) => {
  const { colours } = useTheme();
  const [all, setAll] = useState(false);

  const harness = harnessName(props.harness);

  const strip: Strip | null = stripOf({
    requests: props.requests,
    working: props.workingSince !== null,
    harness,
  });

  if (strip === null) return null;
  const shown = all && strip.more > 0 ? noticesOf(props.requests, harness) : [strip.notice];

  return (
    <View style={[styles.strip, panel(colours)]}>
      <View style={styles.notices}>
        {shown.map((notice) => (
          <Notice
            key={notice.kind === "working" ? "working" : notice.request.id}
            notice={notice}
            props={props}
          />
        ))}
      </View>
      {strip.more > 0 ? <More count={strip.more} open={all} onToggle={() => setAll(!all)} /> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 8,
  },
  notices: { flex: 1, gap: 12 },
  column: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 30 },
  text: { flex: 1, minWidth: 0 },
  headline: { ...mobileType.footnote, fontSize: 12, lineHeight: 16, fontWeight: "500" },
  detail: { ...mobileType.index },
  whole: { maxHeight: 160 },
  time: { ...mobileType.footnote, fontSize: 12, lineHeight: 16, flex: 1 },
  buttons: { flexDirection: "row", alignItems: "center", gap: 4 },
  answer: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  answerLabel: { ...mobileType.footnote, lineHeight: 16, fontWeight: "500" },
  waiting: { opacity: 0.55 },
  questions: { maxHeight: 260 },
  question: { gap: 6 },
  questionText: { ...mobileType.subhead },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    maxWidth: "100%",
  },
  choiceLabel: { ...mobileType.subhead, fontWeight: "500" },
  more: {
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 3,
  },
  moreLabel: { ...mobileType.footnote, fontSize: 12, lineHeight: 16 },
  failed: { ...mobileType.footnote },
});

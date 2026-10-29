/**
 * The task sheet (Paper MX-Z): a tapped star's task as a one-column instrument layout, with
 * status, attempt, claim and worker readouts, then Open worker and Review claim.
 */
import { mobileFont } from "@polaris/ui/tokens";
import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { harnessColour } from "../../celestial/tones.ts";
import { InstrumentSheet } from "../../sheet/index.tsx";
import type { StarState } from "../../starChart/index.ts";
import { CONTENT_TEXT_SCALE } from "../../theme/textScale.ts";
import { type MobileColours, themedStyles, useTheme } from "../../theme/index.ts";
import type { Readout, TaskDetail } from "./detail.ts";

const stateColour = (colours: MobileColours, state: StarState): string => {
  const byState: Readonly<Record<StarState, string>> = {
    done: colours.textStrong,
    working: colours.textStrong,
    review: colours.needsYou,
    blocked: colours.failed,
    failed: colours.failed,
    waiting: colours.textFaint,
  };

  return byState[state];
};

const Instrument = ({
  label,
  readout,
  dot,
  mono = false,
}: {
  readonly label: string;
  readonly readout: Readout;
  readonly dot?: { readonly color: string; readonly round: boolean };
  readonly mono?: boolean;
}) => {
  const styles = useStyles();

  return (
    <View style={styles.instrument} accessible accessibilityLabel={`${label}, ${readout.value}`}>
      <Text style={styles.label} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        {label.toUpperCase()}
      </Text>
      <View style={styles.valueRow}>
        {dot === undefined ? null : (
          <View
            style={[styles.dot, { backgroundColor: dot.color }, dot.round && styles.dotRound]}
          />
        )}
        <Text style={styles.value} numberOfLines={1} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
          {readout.value}
        </Text>
      </View>
      {readout.detail === null ? null : (
        <Text
          style={[styles.detail, mono && styles.mono]}
          numberOfLines={2}
          maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
        >
          {readout.detail}
        </Text>
      )}
    </View>
  );
};

const Close = ({ onClose }: { readonly onClose: () => void }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close"
      hitSlop={8}
      onPress={onClose}
      style={({ pressed }) => [styles.close, pressed && styles.pressed]}
    >
      <Svg width={12} height={12} viewBox="0 0 12 12">
        <Path
          d="M1 1l10 10M11 1L1 11"
          stroke={colours.textSubtle}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      </Svg>
    </Pressable>
  );
};

const Actions = ({
  detail,
  onOpenWorker,
  onReviewClaim,
}: {
  readonly detail: TaskDetail;
  readonly onOpenWorker: () => void;
  readonly onReviewClaim: () => void;
}) => {
  const styles = useStyles();

  if (detail.session === null && !detail.reviewable) return null;

  return (
    <View style={styles.actions}>
      {detail.session === null ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenWorker}
          style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryText} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
            Open worker
          </Text>
        </Pressable>
      )}
      {detail.reviewable ? (
        <Pressable
          accessibilityRole="button"
          onPress={onReviewClaim}
          style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]}
        >
          <Text style={styles.primaryText} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
            Review claim
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const Body = ({
  detail,
  onClose,
  onOpenWorker,
  onReviewClaim,
}: {
  readonly detail: TaskDetail;
  readonly onClose: () => void;
  readonly onOpenWorker: () => void;
  readonly onReviewClaim: () => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const { harness } = detail.worker;

  return (
    <View style={styles.body}>
      <View style={styles.head}>
        <View style={styles.titles}>
          <Text style={styles.kicker} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
            {detail.kicker.toUpperCase()}
          </Text>
          <Text
            accessibilityRole="header"
            style={styles.title}
            maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
          >
            {detail.title}
          </Text>
        </View>
        <Close onClose={onClose} />
      </View>
      <View style={styles.grid}>
        <Instrument
          label="Status"
          readout={detail.status}
          dot={{ color: stateColour(colours, detail.state), round: true }}
        />
        <Instrument label="Attempt" readout={detail.attempt} />
        <Instrument label="Claim" readout={detail.claim} mono />
        <Instrument
          label="Worker"
          readout={detail.worker}
          {...(harness === null
            ? {}
            : { dot: { color: harnessColour(colours, harness), round: false } })}
        />
      </View>
      {detail.branch === null && detail.sentBack === null ? null : (
        <View style={styles.notes}>
          {detail.branch === null ? null : (
            <Text
              style={styles.branch}
              numberOfLines={1}
              ellipsizeMode="middle"
              maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
            >
              {detail.branch}
            </Text>
          )}
          {detail.sentBack === null ? null : (
            <Text style={styles.note} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
              {detail.sentBack}
            </Text>
          )}
        </View>
      )}
      <Actions detail={detail} onOpenWorker={onOpenWorker} onReviewClaim={onReviewClaim} />
    </View>
  );
};

export interface TaskSheetProps {
  readonly detail: TaskDetail | null;
  readonly onClose: () => void;
  readonly onOpenWorker: (session: NonNullable<TaskDetail["session"]>) => void;
  readonly onReviewClaim: (taskId: string) => void;
}

export const TaskSheet = ({ detail, onClose, onOpenWorker, onReviewClaim }: TaskSheetProps) => (
  <InstrumentSheet open={detail !== null} onClose={onClose} detents={["medium", "large"]}>
    {detail === null ? null : (
      <Body
        detail={detail}
        onClose={onClose}
        onOpenWorker={() => (detail.session === null ? undefined : onOpenWorker(detail.session))}
        onReviewClaim={() => onReviewClaim(detail.taskId)}
      />
    )}
  </InstrumentSheet>
);

const mono = { fontFamily: mobileFont.mono } as const;

const useStyles = themedStyles((colours) => ({
  body: { gap: 16, paddingHorizontal: 8, paddingBottom: 8 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  titles: { flex: 1, minWidth: 0, gap: 4 },
  kicker: {
    ...mono,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 0.88,
    color: colours.textSubtle,
  },
  title: {
    fontFamily: mobileFont.sans,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "600",
    color: colours.textStrong,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.raised,
  },
  pressed: { opacity: 0.7 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  instrument: {
    flexBasis: "47%",
    flexGrow: 1,
    gap: 4,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.well,
  },
  label: {
    ...mono,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "500",
    letterSpacing: 0.8,
    color: colours.textFaint,
  },
  valueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 2 },
  dotRound: { borderRadius: 4 },
  value: {
    fontFamily: mobileFont.sans,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "500",
    flexShrink: 1,
    color: colours.textStrong,
  },
  detail: { fontFamily: mobileFont.sans, fontSize: 12, lineHeight: 16, color: colours.textSubtle },
  mono,
  notes: { gap: 2, paddingHorizontal: 2 },
  branch: { ...mono, fontSize: 12, lineHeight: 17, color: colours.textFaint },
  note: { fontFamily: mobileFont.sans, fontSize: 13, lineHeight: 18, color: colours.textSubtle },
  actions: { flexDirection: "row", gap: 10 },
  button: {
    flex: 1,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: { borderWidth: 1, borderColor: colours.hairline, backgroundColor: colours.raised },
  primary: { backgroundColor: colours.textStrong },
  secondaryText: {
    fontFamily: mobileFont.sans,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "600",
    color: colours.textDefault,
  },
  primaryText: {
    fontFamily: mobileFont.sans,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "600",
    color: colours.panel,
  },
}));

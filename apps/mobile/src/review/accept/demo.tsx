/**
 * Development only: MX-T over the app on launch with `-polarisDevAccept 1|2` (open Criticals),
 * an Accept button with its ◆ chip at the foot, so the ask-once flow can be tapped through.
 */
import { LineRange, RiskFinding, RiskFindingId } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { Schema } from "effect";
import { useState } from "react";
import { Platform, Pressable, Settings, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { themedStyles } from "../../theme/index.ts";
import { AcceptChip } from "./AcceptChip.tsx";
import { openCriticals } from "./confirmation.ts";
import { CriticalConfirmation } from "./CriticalConfirmation.tsx";
import { useAcceptReview } from "./useAcceptReview.ts";

const Count = Schema.Literals(["1", "2"]);

const critical = (id: string, title: string, path: string, line: number) =>
  new RiskFinding({
    id: RiskFindingId.make(id),
    identity: id,
    source: "rule",
    ruleId: null,
    path,
    lines: new LineRange({ start: line, end: line, side: "new" }),
    severity: "critical",
    confidence: 0.97,
    title,
    reason: "",
    suggestion: null,
    status: "open",
    resolution: null,
  });

const FINDINGS = [
  critical("secret", "Secret-like value committed", "src/artifact/serve.ts", 4),
  critical("auth", "Upload route skips the auth check", "src/artifact/upload.ts", 18),
];

const launchCount = (): number => {
  const value: unknown = Platform.OS === "ios" ? Settings.get("polarisDevAccept") : undefined;

  return Schema.is(Count)(value) ? Number(value) : 0;
};

const Demo = ({ count }: { readonly count: number }) => {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const findings = FINDINGS.slice(0, count);
  const [accepted, setAccepted] = useState(0);

  const review = useAcceptReview({
    scope: "demo",
    state: { kind: "paused", critical: count },
    findings,
    onAccept: () => setAccepted((n) => n + 1),
  });

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Text style={styles.note}>{`accepted ${accepted}×`}</Text>
      <Pressable accessibilityRole="button" style={styles.accept} onPress={review.accept}>
        <Text style={styles.acceptText}>Accept turn 24</Text>
        <AcceptChip count={openCriticals(findings).length} />
      </Pressable>
      <CriticalConfirmation
        {...review}
        turnNumber={24}
        agentName="Claude Code"
        onAsk={() => undefined}
      />
    </View>
  );
};

export const AcceptDemo = () => {
  const [count] = useState(launchCount);

  return count === 0 ? null : <Demo count={count} />;
};

const useStyles = themedStyles((colours) => ({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    gap: 8,
    paddingTop: 12,
    paddingHorizontal: 20,
    backgroundColor: colours.ground,
  },
  note: { ...mobileType.footnote, color: colours.textSubtle },
  accept: {
    height: 46,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colours.textStrong,
  },
  acceptText: { ...mobileType.heading, color: colours.panel },
}));

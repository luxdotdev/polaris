/**
 * What the queue sends: Accept through `useAcceptReview` (MX-T's confirmation while Criticals are
 * open, keeping their ◆ count), and "Ask {harness} to fix" on the hero's top finding.
 */
import { GitDiffSpec, harnessEntry, type RiskFinding, SessionId, TurnId } from "@polaris/protocol";
import { mobileType, mobileWeight } from "@polaris/ui/tokens";
import { Effect, Match } from "effect";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { haptics } from "../../motion/index.ts";
import type { LiveHost } from "../../runtime/hostConnection.ts";
import { useHost, useLiveHost } from "../../runtime/hosts.tsx";
import { themedStyles } from "../../theme/index.ts";
import { CHROME_TEXT_SCALE } from "../../theme/textScale.ts";
import { CriticalConfirmation, useAcceptReview } from "../accept/index.ts";
import { acceptCommand, askToFixCommand, flaggedCode } from "../actions.ts";
import { type DiffFileInput, fileLines } from "../diffRows.ts";
import { parsePatch } from "../patch.ts";
import { SeverityGlyph } from "../severity.tsx";
import { reviewSlot } from "../submissions.ts";
import { useReviewSubmissions } from "../useSubmissions.ts";
import { openCriticals, type QueueItem, queueAcceptState } from "./queue.ts";

/** MX-K's outline edge, the same in both themes. */
const EDGE = "#ffffff1f";

const useQueueSubmit = (item: QueueItem) => {
  const live = useLiveHost(useHost(item.row.hostId));

  return { live, submissions: useReviewSubmissions(item.row.hostId, live) };
};

/** Accept from the queue: "Accept", or "◆ 1 Accept" while a Critical is open. */
export const QueueAccept = ({ item }: { readonly item: QueueItem }) => {
  const styles = useStyles();
  const { submissions } = useQueueSubmit(item);
  const [notice, setNotice] = useState<string | null>(null);
  const sessionId = item.row.session.id;
  const turnId = item.turn?.turnId ?? null;
  const slot = turnId === null ? null : reviewSlot.accept(sessionId, turnId);
  const sending = slot !== null && submissions.state(slot)?.kind === "sending";
  const state = queueAcceptState(item, sending);
  const critical = openCriticals(item);

  const onAccept = useCallback(() => {
    if (slot === null || turnId === null) return;
    setNotice(null);
    void submissions
      .submit(slot, "", () => acceptCommand(sessionId, turnId))
      .then((failure) => {
        if (failure === null) haptics.approve();
        else setNotice(failure);
      });
  }, [slot, turnId, sessionId, submissions]);

  const review = useAcceptReview({
    state,
    findings: item.turn?.risk.kind === "summary" ? item.turn.risk.summary.findings : [],
    onAccept,
  });

  const enabled = state.kind === "ready" || state.kind === "paused";

  return (
    <View style={styles.acceptWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={critical > 0 ? `Accept, ${critical} critical open` : "Accept"}
        accessibilityState={{ disabled: !enabled, busy: sending }}
        disabled={!enabled}
        onPress={review.accept}
        style={({ pressed }) => [
          styles.accept,
          !enabled ? styles.off : null,
          pressed ? styles.pressed : null,
        ]}
      >
        {critical > 0 ? (
          <>
            <SeverityGlyph severity="critical" size={9} />
            <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.critical}>
              {critical}
            </Text>
          </>
        ) : null}
        <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.label}>
          {sending ? "Accepting…" : "Accept"}
        </Text>
      </Pressable>
      {notice === null ? null : (
        <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.notice} numberOfLines={2}>
          {notice}
        </Text>
      )}
      <CriticalConfirmation
        confirming={review.confirming}
        confirm={review.confirm}
        dismiss={review.dismiss}
      />
    </View>
  );
};

const decoder = new TextDecoder();

/** The turn's lines in the finding's file, for the quote "Ask to fix" sends. */
const findingLines = (live: LiveHost, cwd: string, item: QueueItem, finding: RiskFinding) =>
  Effect.gen(function* () {
    const turnId = item.turn?.turnId ?? "";

    const diff = yield* live.client["git.diff"]({
      cwd,
      spec: GitDiffSpec.cases.Turn.make({
        sessionId: SessionId.make(item.row.session.id),
        turnId: TurnId.make(turnId),
      }),
    });

    const bytes = yield* live.blobs.take(diff.blobId);

    const files = parsePatch(decoder.decode(bytes)).map((diff): DiffFileInput => ({
      diff,
      added: 0,
      removed: 0,
    }));

    return fileLines(files, finding.path);
  }).pipe(Effect.orElseSucceed(() => []));

/** "Ask Claude Code to fix": a feedback Turn quoting the finding's lines. */
export const AskToFix = ({
  item,
  finding,
}: {
  readonly item: QueueItem;
  readonly finding: RiskFinding;
}) => {
  const styles = useStyles();
  const { live, submissions } = useQueueSubmit(item);
  const [notice, setNotice] = useState<string | null>(null);
  const { session } = item.row;
  const slot = reviewSlot.fix(session.id, finding.id);
  const state = submissions.state(slot)?.kind ?? null;
  const harness = harnessEntry(session.harness)?.name ?? session.harness;

  const onPress = () => {
    if (live === null) return setNotice("The host isn't connected");
    setNotice(null);
    void Effect.runPromise(findingLines(live, session.cwd, item, finding))
      .then((lines) => {
        const code = flaggedCode(finding, lines);

        return submissions.submit(slot, code, (commentId) =>
          askToFixCommand(session.id, finding, code, commentId)
        );
      })
      .then((failure) => {
        if (failure === null) haptics.send();
        else setNotice(failure);
      });
  };

  const label = Match.value(state).pipe(
    Match.when("sent", () => `Sent to ${harness}`),
    Match.when("sending", () => "Sending…"),
    Match.orElse(() => `Ask ${harness} to fix`)
  );

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        disabled={state === "sending" || state === "sent"}
        onPress={onPress}
        style={({ pressed }) => [styles.ghost, pressed ? styles.pressed : null]}
      >
        <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.ghostLabel} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
      {notice === null ? null : (
        <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.notice} numberOfLines={2}>
          {notice}
        </Text>
      )}
    </View>
  );
};

const useStyles = themedStyles((c) => ({
  acceptWrap: { alignItems: "flex-end", gap: 4 },
  accept: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: EDGE,
  },
  off: { opacity: 0.55 },
  pressed: { opacity: 0.7 },
  critical: {
    ...mobileType.subhead,
    fontWeight: mobileWeight.medium,
    color: c.severityCriticalText,
    marginRight: 3,
  },
  label: { ...mobileType.subhead, fontWeight: mobileWeight.medium, color: c.textStrong },
  notice: { ...mobileType.footnote, color: c.failedText, maxWidth: 220 },
  ghost: { height: 34, justifyContent: "center", paddingHorizontal: 15, borderRadius: 999 },
  ghostLabel: { ...mobileType.subhead, fontWeight: mobileWeight.medium, color: c.textDefault },
}));

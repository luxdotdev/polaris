/**
 * The half-folded Duo idle (Paper D8): a monitor. Above the fold the night sky with the time and
 * agent sessions as labelled stars; below it the needs you items as 56pt targets, dimmed at
 * night. "Reply…" opens that agent session as the laptop (D7) in place.
 */
import type { ApprovalRequest } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { harnessHue } from "../constellation/glyphs.tsx";
import { homeHostsOf, useFollowedHosts } from "../home/feed/useFollowedHosts.ts";
import { buildHome, type SessionRow } from "../home/model/home.ts";
import { age, harnessName, rowIndex } from "../home/model/format.ts";
import { approvalDetail, askLine, quickQuestion } from "../home/model/lines.ts";
import { type Reply, respond } from "../home/model/respond.ts";
import { Horizon } from "../home/ui/Horizon.tsx";
import { NeedsYouMark, WorkingDither } from "../home/ui/glyphs.tsx";
import { useHosts } from "../runtime/hosts.tsx";
import { isNight, skyLine, type Star, starsOf, targetsOf } from "./monitor.ts";
import type { Rect } from "./posture.ts";

/** The clock moves once a minute, on the minute. */
const useMinute = () => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const next = new Date();
      setNow(next);
      timer = setTimeout(tick, 60_000 - (next.getTime() % 60_000));
    };

    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));

    return () => clearTimeout(timer);
  }, []);

  return now;
};

const clock = (now: Date) => {
  const hours = now.getHours() % 12 === 0 ? 12 : now.getHours() % 12;

  return `${hours}:${String(now.getMinutes()).padStart(2, "0")}`;
};

const StarView = ({ star, sky }: { readonly star: Star; readonly sky: Rect }) => (
  <View style={[styles.star, { left: star.x * sky.width, top: 150 + star.y * (sky.height - 270) }]}>
    {star.tone === "needs-you" ? (
      <NeedsYouMark />
    ) : (
      <View style={styles.halo}>
        <WorkingDither color={harnessHue(star.harness)} size={22} />
        <View style={[styles.core, { backgroundColor: harnessHue(star.harness) }]} />
      </View>
    )}
    <Text
      style={[
        styles.starLabel,
        { color: star.tone === "needs-you" ? midnight.needsYouText : harnessHue(star.harness) },
      ]}
      numberOfLines={1}
    >
      {star.label}
    </Text>
  </View>
);

const Sky = ({
  rect,
  stars,
  now,
  line,
}: {
  readonly rect: Rect;
  readonly stars: ReadonlyArray<Star>;
  readonly now: Date;
  readonly line: ReturnType<typeof skyLine>;
}) => (
  <View style={[styles.sky, { height: rect.height }]}>
    <View style={styles.dusk} />
    <Horizon hour={now.getHours()} />
    <Text style={styles.time} accessibilityRole="header">
      {clock(now)}
    </Text>
    <Text style={styles.line}>
      {line.working}
      {line.working !== "" && line.needsYou !== "" ? " · " : ""}
      <Text style={{ color: midnight.needsYouText }}>{line.needsYou}</Text>
      {line.working === "" && line.needsYou === "" ? "Nothing needs you" : ""}
    </Text>
    {stars.map((star) => (
      <StarView key={star.key} star={star} sky={rect} />
    ))}
  </View>
);

type Send = (row: SessionRow, approval: ApprovalRequest, reply: Reply) => Promise<void>;

const Buttons = ({
  row,
  approval,
  send,
  onReply,
}: {
  readonly row: SessionRow;
  readonly approval: ApprovalRequest;
  readonly send: Send;
  readonly onReply: () => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const live = !row.stale && !busy;

  const go = (reply: Reply) => {
    setBusy(true);
    setFailed(false);
    send(row, approval, reply).then(
      () => setBusy(false),
      () => {
        setBusy(false);
        setFailed(true);
      }
    );
  };

  const quick = approval.kind === "question" ? quickQuestion(approval) : null;
  const tooLong = approvalDetail(approval)?.tooLong === true;

  const choices: ReadonlyArray<{ readonly label: string; readonly reply: Reply }> =
    approval.kind === "question"
      ? (quick?.choices ?? [])
          .slice(0, 2)
          .map((text) => ({ label: text, reply: { kind: "answer", text } }))
      : tooLong
        ? []
        : [
            { label: "Approve", reply: { kind: "approve" } },
            { label: "Always here", reply: { kind: "always" } },
          ];

  return (
    <>
      <View style={[styles.targets, live ? null : styles.waiting]}>
        {choices.map((choice, index) => (
          <Pressable
            key={choice.label}
            accessibilityRole="button"
            disabled={!live}
            onPress={() => go(choice.reply)}
            style={[styles.target, index === 0 ? styles.primary : styles.secondary]}
          >
            <Text style={index === 0 ? styles.primaryLabel : styles.targetLabel} numberOfLines={1}>
              {choice.label}
            </Text>
          </Pressable>
        ))}
        {approval.kind === "question" || tooLong ? (
          <Pressable
            accessibilityRole="button"
            onPress={onReply}
            style={[styles.target, styles.outline, styles.narrow]}
          >
            <Text style={styles.quietLabel}>Reply…</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={!live}
            onPress={() => go({ kind: "deny" })}
            style={[styles.target, styles.outline, styles.narrow]}
          >
            <Text style={styles.quietLabel}>Deny</Text>
          </Pressable>
        )}
      </View>
      {failed ? <Text style={styles.failed}>Couldn't send. Try again.</Text> : null}
    </>
  );
};

const Target = ({
  row,
  index,
  now,
  send,
  onReply,
}: {
  readonly row: SessionRow;
  readonly index: number;
  readonly now: number;
  readonly send: Send;
  readonly onReply: (row: SessionRow) => void;
}) => {
  const approval = row.approval;

  if (approval === null) return null;
  const detail = approvalDetail(approval);
  const quick = approval.kind === "question" ? quickQuestion(approval) : null;

  return (
    <View style={[styles.item, index > 0 ? styles.divided : null]}>
      <View style={styles.titleLine}>
        <Text style={styles.index}>{rowIndex(index)}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {row.session.title === "" ? "Untitled" : row.session.title}
        </Text>
        <Text style={styles.meta}>
          {[harnessName(row.session.harness), row.hostName, age(row.since, now)].join(" · ")}
        </Text>
      </View>
      <Text style={styles.ask} numberOfLines={2}>
        <Text style={{ color: midnight.needsYouText }}>{askLine(approval)}</Text>
        {"  "}
        <Text style={approval.kind === "question" ? styles.askText : styles.command}>
          {approval.kind === "question" ? (quick?.text ?? approval.title) : (detail?.text ?? "")}
        </Text>
      </Text>
      <Buttons row={row} approval={approval} send={send} onReply={() => onReply(row)} />
    </View>
  );
};

export interface MonitorProps {
  readonly top: Rect;
  readonly bottom: Rect;
  readonly division: Rect;
  readonly onReply: (hostId: string, sessionId: string) => void;
}

export const Monitor = ({ top, bottom, division, onReply }: MonitorProps) => {
  const hosts = useFollowedHosts();
  const connections = useHosts();
  const now = useMinute();
  const home = useMemo(() => buildHome(homeHostsOf(hosts), null), [hosts]);
  const stars = useMemo(() => starsOf(home), [home]);
  const targets = targetsOf(home, 4);
  const night = isNight(now.getHours());

  const send: Send = (row, approval, reply) => {
    const connection = connections.find((c) => c.hostId === row.hostId);

    return connection === undefined
      ? Promise.reject(new Error("host gone"))
      : connection.run((client) => respond(client, approval, reply));
  };

  return (
    <View style={styles.monitor}>
      <Sky rect={top} stars={stars} now={now} line={skyLine(home)} />
      <View style={{ height: division.height }} />
      <ScrollView
        style={[{ height: bottom.height }, night ? styles.night : null]}
        contentContainerStyle={styles.bottom}
      >
        {targets.length === 0 ? (
          <Text style={styles.calm}>Nothing needs you.</Text>
        ) : (
          targets.map((row, index) => (
            <Target
              key={row.key}
              row={row}
              index={index}
              now={now.getTime()}
              send={send}
              onReply={(r) => onReply(r.hostId, r.session.id)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  monitor: { flex: 1, backgroundColor: midnight.bg },
  sky: { overflow: "hidden", backgroundColor: "#03050c" },
  dusk: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    top: "45%",
    backgroundColor: "#0a1430",
    opacity: 0.6,
  },
  time: {
    marginTop: 70,
    alignSelf: "center",
    fontSize: 96,
    lineHeight: 104,
    fontWeight: "200",
    color: midnight.textStrong,
    fontVariant: ["tabular-nums"],
  },
  line: { ...mobileType.subhead, alignSelf: "center", color: midnight.textDefault, marginTop: 4 },
  star: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 8 },
  halo: { width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  core: { position: "absolute", width: 4, height: 4 },
  starLabel: { ...mobileType.index, maxWidth: 180 },
  night: { opacity: 0.55 },
  bottom: { paddingHorizontal: 28, paddingTop: 40, paddingBottom: 32 },
  calm: { ...mobileType.callout, color: midnight.textSubtle, alignSelf: "center", paddingTop: 80 },
  item: { gap: 12, paddingVertical: 20 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: midnight.hairline },
  titleLine: { flexDirection: "row", alignItems: "baseline", gap: 18 },
  index: { ...mobileType.index, color: midnight.textFaint, width: 16 },
  title: { ...mobileType.title, fontSize: 19, color: midnight.textStrong, flex: 1 },
  meta: { ...mobileType.footnote, color: midnight.textFaint },
  ask: { ...mobileType.callout, paddingLeft: 34 },
  askText: { color: midnight.textDefault },
  command: { ...mobileType.command, color: midnight.textDefault },
  targets: { flexDirection: "row", gap: 10, paddingLeft: 34 },
  waiting: { opacity: 0.55 },
  target: {
    flex: 1,
    height: 56,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  narrow: { flex: 0, minWidth: 110 },
  primary: { flex: 1.15, backgroundColor: "#c4c5ca" },
  secondary: { backgroundColor: midnight.surfaceRaised },
  outline: { borderWidth: 1, borderColor: midnight.hairline },
  primaryLabel: { ...mobileType.label, fontSize: 17, color: midnight.bg },
  targetLabel: { ...mobileType.label, fontSize: 17, color: midnight.textDefault },
  quietLabel: { ...mobileType.label, fontSize: 17, color: midnight.textSubtle },
  failed: { ...mobileType.footnote, color: midnight.failedText, paddingLeft: 34 },
});

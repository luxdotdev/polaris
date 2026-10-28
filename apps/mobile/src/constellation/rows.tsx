/**
 * The rail list's rows (Paper C2): group headers that fold once finished, and task rows with
 * a glyph, a mono id, the title and state word, then a second line or the handed-up claim.
 */
import { midnight, mobileType } from "@polaris/ui/tokens";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { HandedClaimActions, Checks, type SendVerdict } from "./claim.tsx";
import type { Delivery } from "./outbox.ts";
import type { Unsent } from "./unsent.ts";
import { GateDeps, GroupGlyph, TaskGlyph } from "./glyphs.tsx";
import type { GroupRow, SecondLine, TaskRow, Tone } from "./model.ts";

/** DESIGN.md, Rail glyphs: rail lines are white at ~14%. */
const RAIL = "#ffffff24";

const idColour = (tone: Tone): string => {
  const colours: Readonly<Record<Tone, string>> = {
    "needs-you": midnight.needsYouText,
    done: midnight.acceptedText,
    failed: midnight.failedText,
    waiting: midnight.textFaint,
    ended: midnight.textFaint,
    working: midnight.textSubtle,
    review: midnight.textSubtle,
    blocked: midnight.textSubtle,
  };

  return colours[tone];
};

const wordColour = (tone: Tone): string => {
  if (tone === "needs-you") return midnight.needsYouText;

  if (tone === "done") return midnight.acceptedText;

  if (tone === "failed") return midnight.failedText;

  return tone === "waiting" || tone === "ended" ? midnight.textFaint : midnight.textSubtle;
};

const quiet = (tone: Tone) => tone === "waiting" || tone === "ended";

/** "1 needs you · 1 working", or "3 done · show" for a finished group. */
const GroupCounts = ({ group }: { readonly group: GroupRow }) => {
  if (group.finished)
    return (
      <Text style={styles.groupCount}>
        {group.done} done · {group.open ? "hide" : "show"}
      </Text>
    );

  const parts = [
    group.working > 0 ? `${group.working} working` : null,
    group.review > 0 ? `${group.review} in review` : null,
    `${group.done} of ${group.total} done`,
  ].filter((p) => p !== null);

  return (
    <Text style={[styles.groupCount, { color: midnight.textSubtle }]}>
      {group.needsYou > 0 ? (
        <Text style={{ color: midnight.needsYouText }}>{group.needsYou} needs you · </Text>
      ) : null}
      {parts.join(" · ")}
    </Text>
  );
};

export const GroupHeader = ({
  group,
  onToggle,
}: {
  readonly group: GroupRow;
  readonly onToggle: () => void;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityState={{ expanded: group.open }}
    style={styles.group}
    onPress={onToggle}
  >
    <View style={styles.rail} />
    <GroupGlyph finished={group.finished} />
    <Text style={styles.groupName} numberOfLines={1}>
      {group.name}
    </Text>
    <GroupCounts group={group} />
  </Pressable>
);

const Second = ({
  second,
  worker,
}: {
  readonly second: SecondLine | null;
  readonly worker: string | null;
}) => {
  if (second === null) return worker === null ? null : <Text style={styles.faint}>{worker}</Text>;

  if (second.kind === "activity")
    return (
      <Text style={styles.command} numberOfLines={1}>
        {second.command} · {second.elapsed}
        {worker === null ? null : <Text style={styles.faint}>{`  ${worker}`}</Text>}
      </Text>
    );

  if (second.kind === "claim")
    return (
      <View style={styles.claimLine}>
        <Checks head={second.head} checks={second.checks} />
      </View>
    );

  if (second.kind === "after")
    return (
      <Text style={styles.faint}>
        after <Text style={{ color: midnight.textSubtle }}>{second.ids}</Text>
      </Text>
    );

  return (
    <Text style={styles.faint} numberOfLines={2}>
      {second.text}
    </Text>
  );
};

export const TaskRowView = ({
  row,
  first,
  last,
  delivery,
  onVerdict,
  onCancel,
  unsent,
  onUnsent,
}: {
  readonly row: TaskRow;
  readonly first: boolean;
  readonly last: boolean;
  /** The verdict on its way for this task, if any. */
  readonly delivery: Delivery | null;
  readonly onVerdict: SendVerdict;
  readonly onCancel: () => void;
  /** The claim's unsent choice and answer, kept by the caller (see `HandedClaimActions`). */
  readonly unsent: Unsent | null;
  readonly onUnsent: (next: Unsent) => void;
}) => (
  <View style={[styles.task, !first && styles.divided]}>
    <View style={[styles.rail, last && styles.railEnd]} />
    <TaskGlyph tone={row.tone} harness={row.harness} gate={row.gate} />
    <Text style={[styles.id, { color: idColour(row.tone) }]}>{row.id}</Text>
    <View style={styles.body}>
      <View style={styles.titleLine}>
        {row.gate && row.deps.length > 0 ? <GateDeps deps={row.deps} /> : null}
        <Text
          style={[styles.title, quiet(row.tone) && { color: midnight.textDefault }]}
          numberOfLines={2}
        >
          {row.title}
        </Text>
        <Text style={[styles.word, { color: wordColour(row.tone) }]}>{row.word}</Text>
      </View>
      {row.handed === null && delivery === null ? (
        <Second second={row.second} worker={row.worker} />
      ) : (
        <HandedClaimActions
          claim={row.handed}
          delivery={delivery}
          onVerdict={onVerdict}
          onCancel={onCancel}
          unsent={unsent}
          onUnsent={onUnsent}
        />
      )}
    </View>
  </View>
);

const styles = StyleSheet.create({
  rail: {
    position: "absolute",
    left: 7.25,
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: RAIL,
  },
  railEnd: { bottom: "50%" },
  group: { flexDirection: "row", alignItems: "center", gap: 12, height: 36 },
  groupName: { ...mobileType.footnote, flex: 1, color: midnight.textSubtle },
  groupCount: { ...mobileType.footnote, color: midnight.textDefault },
  task: { flexDirection: "row", gap: 12, paddingVertical: 12 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: midnight.hairline },
  id: { ...mobileType.index, fontSize: 13, lineHeight: 20, width: 26 },
  body: { flex: 1, minWidth: 0, gap: 3 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { ...mobileType.heading, flex: 1, color: midnight.textStrong },
  word: { ...mobileType.footnote },
  command: { ...mobileType.index, color: midnight.textSubtle },
  faint: { ...mobileType.footnote, color: midnight.textFaint },
  claimLine: { paddingTop: 2 },
});

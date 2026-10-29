/**
 * The scan sheet (DESIGN.md, Mobile chrome redesign · phase 3; Paper MX-AJ, MX-AU): scan the code
 * Polaris shows in Settings → Devices, or paste its link, then link once through the Polaris Relay.
 * One component for pairing and for Link another Mac.
 */
import type { LinkedHost } from "@polaris/client/relay";
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { InstrumentSheet, SheetHeader, SheetKicker } from "../sheet/index.tsx";
import { themedStyles, useTheme } from "../theme/index.ts";
import { hostsLine, type LinkOutcome, type LinkStep, linking } from "./linking.ts";
import { Viewfinder } from "./Viewfinder.tsx";

/** The pairing sheet's copy (MX-AH, MX-AJ): the Mac is the user's own. */
export const PAIRING_COPY = {
  kicker: "Scan from your Mac",
  instruction: "On your Mac, open Polaris → Settings → Devices and scan the code.",
  pasteInstruction: "On your Mac, open Polaris → Settings → Devices and copy the link.",
} as const;

/** Link another Mac's copy (MX-AU). */
export const LINK_ANOTHER_COPY = {
  title: "Link another Mac",
  instruction: "On that Mac, open Polaris → Settings → Devices and scan the code.",
  pasteInstruction: "On that Mac, open Polaris → Settings → Devices and copy the link.",
} as const;

export interface ScanSheetProps {
  readonly open: boolean;
  /** The sheet's heading ("Link another Mac"); pairing leaves it out, its screen has the title. */
  readonly title?: string;
  /** The mono kicker over the viewfinder when there is no title ("Scan from your Mac", MX-AH). */
  readonly kicker?: string;
  /** Under the viewfinder: where to find the code. */
  readonly instruction: string;
  /** Over the paste field: where to copy the link. */
  readonly pasteInstruction: string;
  /** Present when the sheet can be closed (Link another Mac); absent on first run. */
  readonly onClose?: (() => void) | undefined;
  /**
   * Links once with the scanned or pasted text and settles with the outcome; a rejection reads as
   * the Keychain refusing the keys. `useRelay().link` is one.
   */
  readonly onLink: (link: string) => Promise<LinkOutcome>;
  /** After the sheet shows "Linked this iPhone", with every Host the link named. */
  readonly onLinked?: ((hosts: ReadonlyArray<LinkedHost>) => void) | undefined;
  /** Each step as it happens, for a screen that lights its star by it (MX-AK, MX-AL, MX-AM). */
  readonly onStep?: ((step: LinkStep) => void) | undefined;
}

const SHEET_HEIGHT = 456;

const noop = () => undefined;

/** MX-AJ's Scan | Paste control, shown while pasting. */
const Segments = ({
  pasting,
  onSelect,
}: {
  readonly pasting: boolean;
  readonly onSelect: (kind: "scan" | "paste") => void;
}) => {
  const styles = useStyles();

  const segment = (kind: "scan" | "paste", label: string, selected: boolean) => (
    <Pressable
      key={kind}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={() => onSelect(kind)}
      style={[styles.segment, selected && styles.segmentOn]}
    >
      <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.segments} accessibilityRole="tablist">
      {segment("scan", "Scan", !pasting)}
      {segment("paste", "Paste", pasting)}
    </View>
  );
};

const PasteField = ({
  pasted,
  setPasted,
  onLink,
}: {
  readonly pasted: string;
  readonly setPasted: (text: string) => void;
  readonly onLink: (text: string) => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <View style={styles.pasteCard}>
      <TextInput
        style={styles.input}
        value={pasted}
        onChangeText={setPasted}
        placeholder="polaris-link:…"
        placeholderTextColor={colours.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        accessibilityLabel="Link from the Desktop App"
      />
      <Pressable
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        accessibilityRole="button"
        onPress={() => onLink(pasted)}
        disabled={pasted.trim() === ""}
      >
        <Text style={styles.linkText}>Link</Text>
      </Pressable>
    </View>
  );
};

const StatusRow = ({ step }: { readonly step: LinkStep }) => {
  const styles = useStyles();

  if (step.kind === "linking" || step.kind === "linked")
    return (
      <View style={styles.status} accessibilityLiveRegion="polite">
        <Text style={styles.statusMark}>{step.kind === "linked" ? "✓" : "·"}</Text>
        <View style={styles.statusText}>
          <Text style={styles.statusTitle} numberOfLines={1}>
            {hostsLine(step.count, step.hostName)}
          </Text>
          <Text style={styles.statusDetail}>
            {step.kind === "linked" ? "Linked this iPhone" : "Linking through the Polaris Relay…"}
          </Text>
        </View>
      </View>
    );

  if (step.kind === "failed")
    return (
      <View style={styles.status} accessibilityLiveRegion="assertive">
        <Text style={[styles.statusMark, styles.failedMark]}>!</Text>
        <View style={styles.statusText}>
          <Text style={styles.statusTitle}>Couldn't link</Text>
          <Text style={styles.failure}>{step.message}</Text>
        </View>
      </View>
    );

  return null;
};

const WideButton = ({
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress: () => void;
}) => {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.wide, pressed && styles.pressed]}
    >
      <Text style={styles.wideText}>{label}</Text>
    </Pressable>
  );
};

/**
 * Scan or paste a link and link once (MX-AJ, MX-AU): the viewfinder over the instruction and
 * "Paste a link instead", which flips to MX-AJ's Scan | Paste control, the link field and Link.
 * A failed link shows the relay's message in mono, with Scan again and Paste a link instead.
 */
export const ScanSheet = ({
  open,
  title,
  kicker = "Scan from your Mac",
  instruction,
  pasteInstruction,
  onClose,
  onLink,
  onLinked,
  onStep,
}: ScanSheetProps) => {
  const styles = useStyles();
  const [step, setStep] = useState<LinkStep>({ kind: "scan" });
  const [pasted, setPasted] = useState("");
  const latest = useRef({ onLink, onLinked, onStep });
  latest.current = { onLink, onLinked, onStep };

  const machine = useMemo(
    () =>
      linking({
        onLink: (link) => latest.current.onLink(link),
        onLinked: (hosts) => latest.current.onLinked?.(hosts),
        onStep: (next) => {
          setStep(next);
          latest.current.onStep?.(next);
        },
      }),
    []
  );

  const pasting = step.kind === "paste";
  const settled = step.kind === "scan" || step.kind === "paste" || step.kind === "failed";

  return (
    <InstrumentSheet
      open={open}
      onClose={onClose ?? noop}
      dismissible={onClose !== undefined}
      scrim={onClose !== undefined}
      detents={[SHEET_HEIGHT]}
    >
      {title === undefined && onClose === undefined ? null : (
        <SheetHeader title={title ?? ""} {...(onClose === undefined ? {} : { onClose })} />
      )}
      {pasting ? (
        <>
          <Segments pasting onSelect={machine.show} />
          <Text style={styles.instruction}>{pasteInstruction}</Text>
          <PasteField pasted={pasted} setPasted={setPasted} onLink={machine.submit} />
        </>
      ) : (
        <>
          {title === undefined ? <SheetKicker parts={[kicker]} /> : null}
          <Viewfinder scanning={step.kind === "scan"} onCode={machine.submit} />
          <Text style={styles.instruction}>{instruction}</Text>
          <StatusRow step={step} />
          {step.kind === "failed" ? (
            <WideButton label="Scan again" onPress={() => machine.show("scan")} />
          ) : null}
          {settled ? (
            <WideButton label="Paste a link instead" onPress={() => machine.show("paste")} />
          ) : null}
        </>
      )}
    </InstrumentSheet>
  );
};

const useStyles = themedStyles((colours) => ({
  instruction: {
    ...mobileType.callout,
    lineHeight: 20,
    color: colours.textDefault,
    paddingHorizontal: 4,
  },
  segments: {
    flexDirection: "row",
    padding: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.well,
  },
  segment: { flex: 1, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: colours.raised },
  segmentText: { ...mobileType.subhead, color: colours.textSubtle },
  segmentTextOn: { color: colours.textStrong, fontWeight: "500" },
  pasteCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.well,
    padding: 14,
    gap: 12,
  },
  input: {
    ...mobileType.command,
    color: colours.textDefault,
    minHeight: 96,
    textAlignVertical: "top",
  },
  link: {
    alignSelf: "flex-end",
    height: 36,
    paddingHorizontal: 18,
    borderRadius: 18,
    justifyContent: "center",
    backgroundColor: colours.textStrong,
  },
  linkText: { ...mobileType.label, color: colours.panel },
  wide: {
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  wideText: { ...mobileType.heading, fontWeight: "600", color: colours.textStrong },
  pressed: { transform: [{ scale: 0.97 }] },
  status: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.well,
  },
  statusMark: { ...mobileType.callout, width: 16, textAlign: "center", color: colours.textDefault },
  failedMark: { color: colours.failedText },
  statusText: { flex: 1, gap: 2 },
  statusTitle: { ...mobileType.callout, lineHeight: 20, color: colours.textStrong },
  statusDetail: { ...mobileType.footnote, lineHeight: 17, color: colours.textFaint },
  failure: { fontFamily: mobileFont.mono, fontSize: 12, lineHeight: 17, color: colours.failedText },
}));

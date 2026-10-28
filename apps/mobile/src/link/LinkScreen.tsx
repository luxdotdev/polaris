/**
 * Link this iPhone (Paper M8): scan the code the Desktop App shows in Settings → Devices,
 * or paste its link, then link once through the Polaris Relay. The link holds a one-time
 * secret: it goes only to `link`, never to a log or the screen.
 */
import type { LinkedHost } from "@polaris/client/relay";
import { decodeLinkString } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { Option } from "effect";
import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRelay } from "../relay/RelayProvider.tsx";
import { Sky } from "./Sky.tsx";

export interface LinkScreenProps {
  readonly onLinked: (hosts: ReadonlyArray<LinkedHost>) => void;
  /** Absent on first run: there is nothing to go back to. */
  readonly onCancel?: (() => void) | undefined;
}

type Step =
  | { readonly kind: "scan" }
  | { readonly kind: "paste" }
  | { readonly kind: "linking"; readonly hostName: string; readonly count: number }
  | { readonly kind: "linked"; readonly hostName: string; readonly count: number }
  | { readonly kind: "failed"; readonly message: string };

const hostsLine = (count: number, hostName: string) =>
  `Found ${count} ${count === 1 ? "host" : "hosts"} on ${hostName}`;

const StatusRow = ({ step }: { readonly step: Step }) => {
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
        <Text style={[styles.statusTitle, styles.statusText]}>{step.message}</Text>
      </View>
    );

  return null;
};

const Scanner = ({ onCode }: { readonly onCode: (text: string) => void }) => {
  const [permission, request] = useCameraPermissions();

  if (permission?.granted === true)
    return (
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(result: BarcodeScanningResult) => onCode(result.data)}
      />
    );

  return (
    <Pressable
      style={styles.cameraOff}
      accessibilityRole="button"
      onPress={() => void request()}
      disabled={permission?.canAskAgain === false}
    >
      <Text style={styles.cameraOffText}>
        {permission?.canAskAgain === false
          ? "Camera access is off. Turn it on in Settings, or paste the link."
          : "Allow the camera to scan the code"}
      </Text>
    </Pressable>
  );
};

export const LinkScreen = ({ onLinked, onCancel }: LinkScreenProps) => {
  const relay = useRelay();
  const [step, setStep] = useState<Step>({ kind: "scan" });
  const [pasted, setPasted] = useState("");
  const busy = useRef(false);

  const start = (text: string) => {
    if (busy.current) return;
    const envelope = Option.getOrNull(decodeLinkString(text));

    // A QR code that isn't a Polaris link is ignored while scanning.
    if (envelope === null) {
      if (step.kind === "paste") setStep({ kind: "failed", message: "That isn't a Polaris link." });

      return;
    }

    busy.current = true;
    const hostName = envelope.link.hostName;
    const count = 1 + envelope.hosts.length;
    setStep({ kind: "linking", hostName, count });

    const failed = (message: string) => {
      busy.current = false;
      setStep({ kind: "failed", message });
    };

    relay.link(text).then(
      (outcome) => {
        if (!outcome.linked) return failed(outcome.message);
        setStep({ kind: "linked", hostName, count });
        onLinked(outcome.hosts);
      },
      // The Keychain refused the keys; the link itself was used.
      () => failed("Couldn't save the link on this iPhone. Make a new one and try again.")
    );
  };

  const pasting = step.kind === "paste";

  return (
    <View style={styles.screen}>
      <Sky />
      <SafeAreaView style={styles.content} edges={["top", "bottom"]}>
        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">
            Link this iPhone
          </Text>
          <Text style={styles.lead}>
            On your Mac, open Polaris → Settings → Devices and scan the code.
          </Text>
        </View>

        {pasting ? (
          <View style={styles.pasteCard}>
            <TextInput
              style={styles.input}
              value={pasted}
              onChangeText={setPasted}
              placeholder="polaris-link:…"
              placeholderTextColor={midnight.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              accessibilityLabel="Link from the Desktop App"
            />
            <Pressable
              style={styles.button}
              accessibilityRole="button"
              onPress={() => start(pasted)}
              disabled={pasted.trim() === ""}
            >
              <Text style={styles.buttonText}>Link</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.scanCard}>
            {step.kind === "scan" ? <Scanner onCode={start} /> : null}
            <View style={styles.frame} pointerEvents="none" />
          </View>
        )}

        <StatusRow step={step} />
        <View style={styles.spacer} />

        <View style={styles.footer}>
          {step.kind === "failed" ? (
            <Pressable accessibilityRole="button" onPress={() => setStep({ kind: "scan" })}>
              <Text style={styles.footerAction}>Scan again</Text>
            </Pressable>
          ) : null}
          {step.kind === "scan" || step.kind === "paste" || step.kind === "failed" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setStep({ kind: pasting ? "scan" : "paste" })}
            >
              <Text style={styles.footerAction}>
                {pasting ? "Scan the code instead" : "Paste a link instead"}
              </Text>
            </Pressable>
          ) : null}
          {onCancel === undefined || step.kind === "linking" ? null : (
            <Pressable accessibilityRole="button" onPress={onCancel}>
              <Text style={styles.footerAction}>Cancel</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: midnight.bg },
  content: { flex: 1 },
  heading: { marginTop: 242, paddingHorizontal: 28, paddingTop: 8, paddingBottom: 24, gap: 10 },
  title: { ...mobileType.largeTitle, color: midnight.textStrong },
  lead: { ...mobileType.body, lineHeight: 24, color: midnight.textSubtle },
  scanCard: {
    marginHorizontal: 28,
    height: 250,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: midnight.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    width: 170,
    height: 170,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: midnight.textStrong,
  },
  cameraOff: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "flex-end" },
  cameraOffText: {
    ...mobileType.footnote,
    color: midnight.textSubtle,
    textAlign: "center",
    paddingHorizontal: 24,
    paddingBottom: 14,
  },
  pasteCard: {
    marginHorizontal: 28,
    borderRadius: 22,
    padding: 16,
    gap: 12,
    backgroundColor: midnight.surfaceRaised,
  },
  input: {
    ...mobileType.command,
    color: midnight.textDefault,
    minHeight: 120,
    textAlignVertical: "top",
  },
  button: {
    alignSelf: "flex-end",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: midnight.fillSelected,
  },
  buttonText: { ...mobileType.label, color: midnight.textStrong },
  status: {
    marginHorizontal: 28,
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: midnight.hairline,
    backgroundColor: midnight.surfaceSunken,
  },
  statusMark: {
    ...mobileType.callout,
    width: 16,
    textAlign: "center",
    color: midnight.textDefault,
  },
  failedMark: { color: midnight.failedText },
  statusText: { flex: 1, gap: 2 },
  statusTitle: { ...mobileType.callout, lineHeight: 20, color: midnight.textStrong },
  statusDetail: { ...mobileType.footnote, lineHeight: 17, color: midnight.textFaint },
  spacer: { flex: 1 },
  footer: { alignItems: "center", gap: 14, paddingBottom: 48 },
  footerAction: { ...mobileType.body, fontSize: 16, lineHeight: 21, color: midnight.textSubtle },
});

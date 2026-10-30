/**
 * The scan sheet's viewfinder (Paper MX-AU): the camera in a well behind corner brackets, or the
 * line that asks for the camera when it isn't allowed.
 */
import { mobileType } from "@polaris/ui/tokens";
import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { CHROME_TEXT_SCALE } from "../theme/textScale.ts";
import { themedStyles, useTheme } from "../theme/index.ts";

const BRACKETS =
  "M2 30V10a8 8 0 0 1 8-8h20M102 2h20a8 8 0 0 1 8 8v20M130 102v20a8 8 0 0 1-8 8h-20M30 130H10a8 8 0 0 1-8-8v-20";

const Camera = ({ onCode }: { readonly onCode: (text: string) => void }) => {
  const styles = useStyles();
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
      <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.cameraOffText}>
        {permission?.canAskAgain === false
          ? "Camera access is off. Turn it on in Settings, or paste the link."
          : "Allow the camera to scan the code"}
      </Text>
    </Pressable>
  );
};

/** Scans only while `scanning`; otherwise the well stays as a still frame. */
export const Viewfinder = ({
  scanning,
  onCode,
}: {
  readonly scanning: boolean;
  readonly onCode: (text: string) => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <View style={styles.well}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <RadialGradient id="viewfinder-glow" cx="50%" cy="40%" r="70%">
            <Stop offset="0" stopColor={colours.raised} />
            <Stop offset="1" stopColor={colours.well} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#viewfinder-glow)" />
      </Svg>
      {scanning ? <Camera onCode={onCode} /> : null}
      <Svg width={152} height={152} viewBox="0 0 132 132" pointerEvents="none">
        <Path
          d={BRACKETS}
          fill="none"
          stroke={colours.textStrong}
          strokeWidth={3}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  well: {
    height: 224,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.well,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  cameraOff: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "flex-end" },
  cameraOffText: {
    ...mobileType.footnote,
    color: colours.textSubtle,
    textAlign: "center",
    paddingHorizontal: 24,
    paddingBottom: 14,
  },
}));

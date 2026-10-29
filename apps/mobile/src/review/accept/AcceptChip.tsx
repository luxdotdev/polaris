/** The ◆ count of open Criticals inside the Accept button (Paper MX-T, MX-K); none at zero. */
import { mobileFont } from "@polaris/ui/tokens";
import { Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { CHROME_TEXT_SCALE } from "../../theme/textScale.ts";
import { themedStyles, useTheme } from "../../theme/index.ts";

export interface AcceptChipProps {
  /** The open Criticals, as `openCriticals(findings).length`. */
  readonly count: number;
}

export const AcceptChip = ({ count }: AcceptChipProps) => {
  const styles = useStyles();
  const { colours } = useTheme();

  if (count === 0) return null;

  return (
    <View
      style={styles.chip}
      accessible
      accessibilityLabel={count === 1 ? "1 critical open" : `${count} criticals open`}
    >
      <Svg width={7} height={7} viewBox="0 0 8 8">
        <Path d="M4 0L8 4 4 8 0 4z" fill={colours.severityCritical} />
      </Svg>
      <Text maxFontSizeMultiplier={CHROME_TEXT_SCALE} style={styles.count}>
        {count}
      </Text>
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  chip: {
    height: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    borderRadius: 999,
    backgroundColor: colours.severityCriticalFill,
  },
  count: {
    fontFamily: mobileFont.mono,
    fontSize: 11,
    lineHeight: 14,
    color: colours.severityCritical,
  },
}));

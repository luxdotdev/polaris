/** MX-N's file list: each changed file with its counts; a row opens the file full screen (MX-Q). */
import { mobileType } from "@polaris/ui/tokens";
import { Pressable, Text, View } from "react-native";
import { themedStyles } from "../../theme/index.ts";
import { CONTENT_TEXT_SCALE } from "../../theme/textScale.ts";
import type { DiffFileInput } from "../diffRows.ts";
import type { DiffPalette } from "../palette.ts";

export interface FilesProps {
  readonly files: ReadonlyArray<DiffFileInput>;
  readonly palette: DiffPalette;
  readonly onOpen: (index: number) => void;
}

export const Files = ({ files, palette, onOpen }: FilesProps) => {
  const styles = useStyles();

  if (files.length === 0) return null;

  return (
    <View style={styles.well}>
      {files.map((file, i) => (
        <Pressable
          key={file.diff.name}
          accessibilityRole="button"
          accessibilityHint="Opens the file's diff"
          onPress={() => onOpen(i)}
          style={({ pressed }) => [styles.row, i > 0 && styles.rule, pressed && styles.pressed]}
        >
          <Text
            maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
            numberOfLines={1}
            ellipsizeMode="head"
            style={styles.path}
          >
            {file.diff.name}
          </Text>
          <Text style={[styles.count, { color: palette.addedText }]}>+{file.added}</Text>
          <Text style={[styles.count, { color: palette.removedText }]}>−{file.removed}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  well: {
    marginTop: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.well,
    paddingHorizontal: 14,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  rule: { borderTopWidth: 1, borderTopColor: colours.hairline },
  pressed: { opacity: 0.7 },
  path: { ...mobileType.index, fontSize: 13, lineHeight: 18, flex: 1, color: colours.textDefault },
  count: { ...mobileType.index, flexShrink: 0 },
}));

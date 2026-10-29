/** One hunk drawn inline under a finding (MX-N): its label, unified lines and the findings it shows. */
import { mobileType } from "@polaris/ui/tokens";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { themedStyles } from "../theme/index.ts";
import { DiffFindingCard } from "./FindingCard.tsx";
import { gutterWidth, mono, UnifiedLine } from "./lines.tsx";
import { hunkRows } from "./rows.ts";
import type { HunkViewProps } from "./types.ts";

const NO_FINDINGS: HunkViewProps["findings"] = [];

export const HunkView = ({
  file,
  hunk,
  palette,
  label,
  findings = NO_FINDINGS,
  actions,
}: HunkViewProps) => {
  const styles = useStyles();
  const rows = useMemo(() => hunkRows(file, hunk, findings), [file, hunk, findings]);

  const gutter = gutterWidth(
    Math.max(hunk.deletionStart + hunk.deletionCount, hunk.additionStart + hunk.additionCount) - 1
  );

  return (
    <View style={styles.panel}>
      {rows.map((row) => {
        switch (row.kind) {
          case "hunk":
            return (
              <Text
                key={row.key}
                style={styles.header}
                numberOfLines={1}
                ellipsizeMode={label === undefined ? "tail" : "middle"}
              >
                {label ?? row.header}
              </Text>
            );
          case "line":
            return <UnifiedLine key={row.key} line={row.line} palette={palette} gutter={gutter} />;
          case "finding":
            return <DiffFindingCard key={row.key} finding={row.finding} actions={actions} />;
          case "pair":
            return null;
        }
      })}
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  panel: { paddingVertical: 8, backgroundColor: colours.panel },
  header: {
    ...mono,
    fontFamily: mobileType.index.fontFamily,
    fontSize: 11,
    lineHeight: 14,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 8,
    color: colours.textFaint,
  },
}));

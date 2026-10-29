import type { FileDiffMetadata, Hunk } from "@pierre/diffs";
import type { RiskFinding } from "@polaris/protocol";
import type { DiffFileInput } from "../review/diffRows.ts";
import type { DiffPalette } from "../review/palette.ts";

export interface HunkViewProps {
  readonly file: FileDiffMetadata;
  readonly hunk: Hunk;
  readonly palette: DiffPalette;
  /** Listed findings to place under the lines they flag. */
  readonly findings?: ReadonlyArray<RiskFinding>;
}

export interface FileDiffScreenProps {
  readonly files: ReadonlyArray<DiffFileInput>;
  /** The file shown, an index into `files`. */
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  readonly findings?: ReadonlyArray<RiskFinding>;
  readonly colourblind?: boolean;
  readonly onBack?: () => void;
}

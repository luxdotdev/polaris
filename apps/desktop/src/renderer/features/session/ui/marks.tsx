import { Dither, type Harness } from "@polaris/ui";

export type Hue = Harness | null;

export const WELL = "rounded-row border-hairline bg-surface-raised/50 border";

export const LiveMark = ({ hue }: { readonly hue: Hue }) =>
  hue === null ? null : <Dither hue={hue} size={12} moving />;

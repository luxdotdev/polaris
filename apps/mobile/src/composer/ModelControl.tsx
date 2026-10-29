/** The model chip and the sheet it opens, for a session the composer can change. */
import type { CelestialBody } from "@polaris/protocol";
import { ModelChip } from "./ControlRow.tsx";
import { ModelSheet } from "./ModelSheet.tsx";
import { type ModelSheetContext, useModelSheet } from "./useModelSheet.ts";

export const ModelControl = ({
  context,
  celestial,
  working,
}: {
  readonly context: ModelSheetContext;
  readonly celestial: CelestialBody | null;
  readonly working: boolean;
}) => {
  const sheet = useModelSheet(context);

  return (
    <>
      <ModelChip
        harness={sheet.harness}
        celestial={celestial}
        label={sheet.label}
        working={working}
        onPress={context.connection === null ? null : () => sheet.setOpen(true)}
      />
      <ModelSheet input={sheet} />
    </>
  );
};

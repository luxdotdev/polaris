/**
 * The composer's model sheet before the session exists (MX-AO): the same sheet as a running
 * session's, but each pick only changes what the first send starts with.
 */
import type { HarnessKind } from "@polaris/protocol";
import { useState } from "react";
import { permissionModesFor } from "../composer/modelSheet.ts";
import type { ModelSheetInput } from "../composer/useModelSheet.ts";
import { modelLabel, shortlist } from "./harness.ts";
import type { SheetHost } from "./model.ts";
import type { PermissionChoice } from "./permissionModes.ts";
import type { HarnessChoice } from "./useHarnessChoice.ts";

/** Null while no Harness is chosen: the chip reads "No harness" and opens nothing. */
export const useStartSheet = (
  choice: HarnessChoice,
  permission: PermissionChoice,
  host: SheetHost | null
): ModelSheetInput | null => {
  const [open, setOpen] = useState(false);
  const harness: HarnessKind | null = choice.harness;

  if (harness === null) return null;

  const shown =
    choice.model ?? shortlist(harness, choice.models).top.find((m) => m.isDefault) ?? null;

  const options = choice.load.kind === "loaded" ? choice.load.options : [];

  return {
    open,
    setOpen,
    harness,
    models: choice.models,
    model: shown,
    label: modelLabel(harness, choice.models, choice.model),
    effort: choice.effort,
    change: { kind: "set" },
    note: null,
    forkTo: options.filter((o) => o.kind !== harness && o.startable),
    harnessPick: "choose",
    permission: permission.mode,
    permissions: permissionModesFor(host?.capabilities ?? []),
    error: null,
    pickModel: (model, effort) => {
      choice.setModel(model);
      choice.setEffort(effort);
    },
    pickPermission: permission.pick,
    forkOn: choice.setHarness,
  };
};

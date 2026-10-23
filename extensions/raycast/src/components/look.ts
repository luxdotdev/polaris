/** Session State in Raycast: only Needs You and Failed take a colour (DESIGN.md, Signals). */
import { Color, Icon, type Image, type List } from "@raycast/api";
import type { SessionState } from "@polaris/sdk";
import { STATE_LABEL } from "../lib/copy.ts";

const NEEDS_YOU = { light: "#B98A00", dark: "#F2C84B", adjustContrast: false };

const FAILED = { light: "#D23B30", dark: "#F0645A", adjustContrast: false };

const ICON: Readonly<Record<SessionState, Image.Source>> = {
  starting: Icon.CircleProgress25,
  working: Icon.CircleProgress50,
  "needs-you": Icon.Bell,
  idle: Icon.Circle,
  "in-terminal": Icon.Terminal,
  dormant: Icon.Moon,
  failed: Icon.XMarkCircle,
  limited: Icon.Hourglass,
  archived: Icon.Tray,
};

const colorOf = (state: SessionState) => {
  if (state === "needs-you") return NEEDS_YOU;

  return state === "failed" ? FAILED : Color.SecondaryText;
};

export const stateIcon = (state: SessionState): Image.ImageLike => ({
  source: ICON[state],
  tintColor: colorOf(state),
});

export const stateTag = (state: SessionState): List.Item.Accessory => ({
  tag: { value: STATE_LABEL[state], color: colorOf(state) },
});

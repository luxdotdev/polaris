/** The editor's toasts: Polaris's own news (Starlight), with the failed pixel icon. */
import { PixelFailedIcon, showToast } from "@polaris/ui";
import { createElement } from "react";
import type { ToastText } from "../model/notices.ts";

export const showOpenFailure = ({ title, message }: ToastText) =>
  showToast({
    source: "starlight",
    icon: createElement(PixelFailedIcon, { size: 16 }),
    title,
    message,
  });

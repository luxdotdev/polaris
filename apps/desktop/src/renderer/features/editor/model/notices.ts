/** The toast for an open that couldn't read its file (the lead's copy): what, where, why. */
import { crumbs } from "./paths.ts";

export type Unreadable =
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string };

export interface ToastText {
  readonly title: string;
  readonly message: string;
}

/** "Couldn't open daemon/src/a.ts" / "Not found on Mac Studio.", or the Daemon's reason. */
export const unreadableToast = (
  path: string,
  root: string | null,
  hostLabel: string,
  reason: Unreadable
): ToastText => ({
  title: `Couldn't open ${root === null ? path : crumbs(path, root).join("/")}`,
  message:
    reason.kind === "missing"
      ? `Not found on ${hostLabel}.`
      : `${reason.message.replace(/\.$/, "")} (on ${hostLabel}).`,
});

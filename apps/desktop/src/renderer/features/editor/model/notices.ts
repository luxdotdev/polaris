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
  host: { readonly label: string; readonly home: string | null },
  reason: Unreadable
): ToastText => ({
  title: `Couldn't open ${crumbs(path, root ?? "/", host.home).join("/")}`,
  message:
    reason.kind === "missing"
      ? `Not found on ${host.label}.`
      : `${reason.message.replace(/\.$/, "")} (on ${host.label}).`,
});

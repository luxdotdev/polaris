/**
 * What every right-click menu shares: shortcuts read from KEYMAP (or a feature's own key
 * table) through the app's chord formatting, never typed by hand, and the copy and reveal
 * actions (DESIGN.md, Menus).
 */
import { clientCopy } from "../../../shared/clientCopy.ts";
import {
  COPY_FAILED,
  type CopyWrite,
  type MenuAction,
  PixelCheckIcon,
  PixelFailedIcon,
  showToast,
} from "@polaris/ui";
import { createElement } from "react";
import { acceleratorLabel, currentKeyPlatform } from "../../../shared/chord.ts";
import { chordOf, type CommandId, EDIT_CHORDS } from "../../../shared/keymap.ts";
import { polaris } from "../../features/bridge.ts";
import { writeClipboard } from "../../features/clipboard.ts";
import { LOCAL_HOST } from "../../routes/topBar.ts";

/** A command's chord as the menu shows it ("⌥⌘T"), or nothing when it has none. */
export const menuShortcut = (id: CommandId): string | undefined =>
  acceleratorLabel(chordOf(id, currentKeyPlatform()));

/** The standard edit chords the native Edit menu owns ("⌘C"). */
export const editShortcut = (action: keyof typeof EDIT_CHORDS): string =>
  acceleratorLabel(EDIT_CHORDS[action]) ?? "";

/** Copies `text` and answers in a 1.5s toast ("Copied path", or "Couldn't copy"). */
export const copyWithToast = (text: string, what: string, write: CopyWrite = writeClipboard) =>
  void write(text)
    .catch(() => false)
    .then((ok) =>
      showToast({
        source: "starlight",
        icon: createElement(ok ? PixelCheckIcon : PixelFailedIcon, { size: 16 }),
        title: ok ? `Copied ${what}` : COPY_FAILED,
        duration: 1500,
      })
    );

/** A "Copy …" row: its label names what it copies ("Copy path" → "Copied path"). */
export const copyEntry = (label: string, text: string, testId?: string): MenuAction => ({
  kind: "item",
  label,
  onSelect: () => copyWithToast(text, lowerFirst(label.replace(/^Copy /, ""))),
  testId,
});

const lowerFirst = (text: string) =>
  /^[A-Z][a-z]/.test(text) ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;

/** Reveal in Finder (Show in Explorer), for local Workspaces only; a remote Host's path has none. */
export const revealInFinderEntry = (hostKey: string, path: string): MenuAction | null =>
  hostKey === LOCAL_HOST
    ? {
        kind: "item",
        label: clientCopy().reveal,
        onSelect: () => void polaris().request("shell.revealInFinder", { hostKey, path }),
        testId: "menu-reveal-in-finder",
      }
    : null;

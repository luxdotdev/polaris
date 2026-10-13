/**
 * The keyboard shortcut overlay (⌘/ or ?): every binding from the keymap by
 * where it lives, plus the keys other parts of the app handle themselves.
 */
import { Dialog, DialogContent, DialogDescription, DialogTitle, Kbd } from "@polaris/ui";
import {
  currentKeyPlatform,
  formatChord,
  type KeyPlatform,
  parseChord,
  shortcutLabel,
} from "../../shared/chord.ts";
import {
  digitModifiersFor,
  FIELD_CHORDS,
  type KeyBinding,
  keymapFor,
  type MenuName,
  paletteEntry,
} from "../../shared/keymap.ts";
import { useNav, useShellActions } from "./hooks.ts";

interface Row {
  readonly title: string;
  readonly keys: ReadonlyArray<string>;
}

const labels = (b: KeyBinding, platform: KeyPlatform) =>
  b.keys.map((k) => formatChord(parseChord(k), platform));

const fromKeymap = (menu: MenuName, platform: KeyPlatform): ReadonlyArray<Row> =>
  keymapFor(platform)
    .filter((b) => b.menu === menu && b.keys.length > 0)
    .map((b) => ({ title: b.title, keys: labels(b, platform) }));

/** The focused file's commands with a shortcut and no menu (save, restart the server…). */
const editorRows = (platform: KeyPlatform): ReadonlyArray<Row> =>
  keymapFor(platform)
    .filter((b) => b.menu === undefined && b.keys.length > 0 && paletteEntry(b)?.group === "file")
    .map((b) => ({ title: b.title, keys: labels(b, platform) }));

/** "⌃1…⌃0", or "Alt+1…Alt+0" on Windows. */
const digitRange = (modifier: string, platform: KeyPlatform) =>
  `${shortcutLabel(`${modifier}+1`, platform)}…${shortcutLabel(`${modifier}+0`, platform)}`;

interface Section {
  readonly heading: string;
  readonly rows: ReadonlyArray<Row>;
}

export const shortcutSections = (platform: KeyPlatform): ReadonlyArray<Section> => [
  {
    heading: "Move around",
    rows: [
      ...fromKeymap("Go", platform),
      {
        title: "Workspace or machine 1–10",
        keys: digitModifiersFor(platform).map((m) => digitRange(m, platform)),
      },
      { title: "Between session rows", keys: ["↑", "↓"] },
      ...fromKeymap("View", platform),
      ...fromKeymap("App", platform),
    ],
  },
  {
    heading: "Sessions",
    rows: [
      ...fromKeymap("Session", platform),
      { title: "Send, or steer while working", keys: [shortcutLabel("Enter", platform)] },
      {
        title: "Queue a follow-up for after the turn",
        keys: [shortcutLabel(FIELD_CHORDS.submit, platform)],
      },
      { title: "New line", keys: [shortcutLabel(FIELD_CHORDS.newLine, platform)] },
      { title: "Stop from the composer", keys: [shortcutLabel("Esc", platform)] },
    ],
  },
  { heading: "Editor", rows: editorRows(platform) },
  { heading: "Help", rows: fromKeymap("Help", platform) },
];

export const ShortcutHelp = () => {
  const open = useNav((s) => s.helpOpen);
  const { setHelpOpen } = useShellActions();

  // Only while open, like the jump menu: no lingering layer to take the next Escape.
  if (!open) return null;

  return (
    <Dialog open onOpenChange={setHelpOpen}>
      <DialogContent
        showClose
        className="max-h-[calc(100vh-96px)] w-[560px] overflow-y-auto p-6"
        aria-describedby="shortcut-help-description"
      >
        <DialogTitle className="text-title text-text-strong">Keyboard shortcuts</DialogTitle>
        <DialogDescription id="shortcut-help-description" className="sr-only">
          Every keyboard shortcut in Polaris
        </DialogDescription>
        <div className="gap-section flex flex-col pt-2">
          {shortcutSections(currentKeyPlatform()).map((section) => (
            <section
              key={section.heading}
              aria-label={section.heading}
              className="flex flex-col gap-1"
            >
              <h3 className="text-caption text-text-subtle pb-1">{section.heading}</h3>
              <dl className="flex flex-col">
                {section.rows.map((row) => (
                  <div key={row.title} className="h-row gap-gap flex items-center">
                    <dt className="text-body text-text-default flex-1">{row.title}</dt>
                    <dd className="flex gap-1.5">
                      {row.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

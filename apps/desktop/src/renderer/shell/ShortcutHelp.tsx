/**
 * The keyboard shortcut overlay (⌘/ or ?): every binding from the keymap by
 * where it lives, plus the keys other parts of the app handle themselves.
 */
import { Dialog, DialogContent, DialogDescription, DialogTitle, Kbd } from "@polaris/ui";
import { formatChord, parseChord } from "../../shared/chord.ts";
import { KEYMAP, type MenuName } from "../../shared/keymap.ts";
import { useNav, useShellActions } from "./hooks.ts";

interface Row {
  readonly title: string;
  readonly keys: ReadonlyArray<string>;
}

const fromKeymap = (menu: MenuName): ReadonlyArray<Row> =>
  KEYMAP.filter((b) => b.menu === menu && b.keys.length > 0).map((b) => ({
    title: b.title,
    keys: b.keys.map((k) => formatChord(parseChord(k))),
  }));

const SECTIONS: ReadonlyArray<{ readonly heading: string; readonly rows: ReadonlyArray<Row> }> = [
  {
    heading: "Move around",
    rows: [
      ...fromKeymap("Go"),
      { title: "Workspace or machine 1–10", keys: ["⌃1…⌃0", "⌥1…⌥0"] },
      { title: "Between session rows", keys: ["↑", "↓"] },
      ...fromKeymap("View"),
      ...fromKeymap("App"),
    ],
  },
  {
    heading: "Sessions",
    rows: [
      ...fromKeymap("Session"),
      { title: "Send, or steer while working", keys: ["↵"] },
      { title: "New line", keys: ["⇧↵"] },
      { title: "Stop from the composer", keys: ["esc"] },
    ],
  },
  { heading: "Help", rows: fromKeymap("Help") },
];

export const ShortcutHelp = () => {
  const open = useNav((s) => s.helpOpen);
  const { setHelpOpen } = useShellActions();

  return (
    <Dialog open={open} onOpenChange={setHelpOpen}>
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
          {SECTIONS.map((section) => (
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

/**
 * The Command Palette (⇧⌘P; DESIGN.md, Command Palette; Paper L5): its own card,
 * separate from the jump menu. A "›" field, Recent first on an empty query, then
 * the focused file's commands, the Workspace's and the app's. ↑↓ move, ↵ runs,
 * Tab and ⇧Tab jump between groups, esc closes; a "…" command asks its follow-up here.
 */
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@polaris/ui";
import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { CommandContext } from "../../../../shared/keymap.ts";
import type { FollowUp, PaletteCommand } from "../../../routes/commands.ts";
import { useCommands, useNav, useShellActions } from "../../../shell/hooks.ts";
import { flatten, type GroupKey, paletteGroups } from "../model/groups.ts";
import { highlighted, stepGroup, stepRow } from "../model/keyboard.ts";
import { clearFollowUp, paletteStore, recordRecent } from "../store.ts";
import { PaletteFooter, RowList, type ShownRow } from "./parts.tsx";

const Heading = ({ group, values }: { group: GroupKey; values: CommandContext["values"] }) => {
  if (group === "recent") return <>Recent</>;

  if (group === "workspace")
    return <>{values.workspace === undefined ? "Workspace" : `Workspace · ${values.workspace}`}</>;

  if (group === "app") return <>Polaris</>;

  return (
    <>
      {values.language ?? "This file"}
      {values.file === undefined ? null : (
        <>
          {" · "}
          <span className="font-mono">{values.file}</span>
        </>
      )}
    </>
  );
};

const commandRow = (c: PaletteCommand): ShownRow => ({
  id: c.id,
  title: c.followUp && !c.title.endsWith("…") ? `${c.title}…` : c.title,
  detail: c.detail,
  shortcut: c.shortcut,
  ariaKeys: c.ariaKeys,
  disabled: false,
});

interface StepProps {
  readonly onClose: () => void;
}

/** The commands, grouped and ranked. */
const Commands = ({ onClose }: StepProps) => {
  const commands = useCommands();
  const recent = useStore(paletteStore, (s) => s.recent);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<string | null>(null);

  // The context and the rows are read once on open: the palette shows that moment.
  const [{ rows, values }] = useState(() => ({
    rows: commands.palette(),
    values: commands.context().values,
  }));

  const groups = useMemo(
    () => paletteGroups({ query, commands: rows, recent }),
    [query, rows, recent]
  );

  const selected = highlighted(groups, current);
  const listed = rows.filter((r) => !r.searchOnly).length;

  const run = (command: PaletteCommand) => {
    recordRecent(command.id);

    if (!command.followUp) onClose();
    commands.runAny(command.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setCurrent(stepRow(groups, selected, event.key === "ArrowUp" ? -1 : 1));

      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      setCurrent(stepGroup(groups, selected, event.shiftKey ? -1 : 1));

      return;
    }

    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const command = flatten(groups).find((c) => c.id === selected);

    if (command !== undefined) run(command);
  };

  return (
    <RowList
      query={query}
      onQuery={(q) => {
        setQuery(q);
        setCurrent(null);
      }}
      placeholder="Run a command"
      label="Run a command"
      onKeyDown={onKeyDown}
      selected={selected}
      sections={groups.map((g) => ({
        key: g.key,
        heading: <Heading group={g.key} values={values} />,
        rows: g.items.map(commandRow),
      }))}
      onHover={setCurrent}
      onChoose={(id) => {
        const command = rows.find((r) => r.id === id);

        if (command !== undefined) run(command);
      }}
      footer={
        <PaletteFooter
          hints={["↑↓ move", "↵ run", "tab next group"]}
          count={query.trim() === "" ? listed : flatten(groups).length}
        />
      }
    />
  );
};

/** A "…" command's question: its choices, and ⌫ on an empty field goes back. */
const Ask = ({ followUp, onClose }: StepProps & { readonly followUp: FollowUp }) => {
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const choices = followUp.choices.filter((c) => c.title.toLowerCase().includes(q));
  const sections = [{ items: choices.filter((c) => c.disabled !== true) }];
  const selected = highlighted(sections, current);

  const choose = (id: string | null) => {
    const choice = choices.find((c) => c.id === id && c.disabled !== true);

    if (choice === undefined) return;
    onClose();
    choice.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && query === "") {
      event.preventDefault();
      clearFollowUp();

      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Tab") {
      event.preventDefault();
      setCurrent(stepRow(sections, selected, event.key === "ArrowUp" || event.shiftKey ? -1 : 1));

      return;
    }

    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      choose(selected);
    }
  };

  return (
    <RowList
      query={query}
      onQuery={(next) => {
        setQuery(next);
        setCurrent(null);
      }}
      placeholder={followUp.title}
      label={followUp.title}
      onKeyDown={onKeyDown}
      selected={selected}
      note={followUp.note}
      sections={[
        {
          key: "choices",
          heading: null,
          rows: choices.map((c) => ({
            id: c.id,
            title: c.title,
            detail: c.detail ?? "",
            shortcut: "",
            ariaKeys: "",
            disabled: c.disabled === true,
          })),
        },
      ]}
      onHover={setCurrent}
      onChoose={choose}
      footer={<PaletteFooter hints={["↑↓ move", "↵ choose", "⌫ back"]} count={null} />}
    />
  );
};

/** The card's content: the commands, or the follow-up being asked. */
export const PaletteBody = ({ onClose }: StepProps) => {
  const followUp = useStore(paletteStore, (s) => s.followUp);

  return followUp === null ? (
    <Commands onClose={onClose} />
  ) : (
    <Ask key={followUp.title} followUp={followUp} onClose={onClose} />
  );
};

/** Rendered only while open, like the jump menu, so no closing layer takes the next Escape. */
export const CommandPalette = () => {
  const open = useNav((s) => s.paletteOpen);
  const { setPaletteOpen } = useShellActions();
  const description = useId();

  useEffect(() => {
    if (!open) clearFollowUp();
  }, [open]);

  if (!open) return null;

  return (
    <Dialog open onOpenChange={setPaletteOpen}>
      <DialogContent
        placement="top"
        className="w-[620px]"
        aria-describedby={description}
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription id={description} className="sr-only">
          Run any command in Polaris. Tab moves between groups.
        </DialogDescription>
        <PaletteBody onClose={() => setPaletteOpen(false)} />
      </DialogContent>
    </Dialog>
  );
};

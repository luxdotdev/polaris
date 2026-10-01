/**
 * A review bot's commands (Paper R9 B4G-0): Re-run `/review`, Retry `/retry`, Teach
 * `/memory`. They post to the pull request as the viewer, so the first one to each bot asks;
 * Teach always asks for what to remember.
 */
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  Textarea,
} from "@polaris/ui";
import { useRef, useState } from "react";
import type { OpenPull } from "../../../../../shared/api.ts";
import { confirmBot, postBotCommand, useBotConfirmed } from "../data/actions.ts";
import { BOT_COMMANDS, type BotCommand, shortSha } from "../model/botSummary.ts";
import { MoreButton } from "./parts.tsx";

export interface BotMenuProps {
  readonly bot: string;
  readonly pull: Pick<OpenPull, "repo" | "number">;
  readonly head: string;
  readonly viewer: string;
  readonly stale: boolean;
}

const titleCase = (name: string) => `${name.slice(0, 1).toUpperCase()}${name.slice(1)}`;

const labelOf = (command: BotCommand, bot: string, head: string) => {
  if (command.command === "review") return head === "" ? "Re-run" : `Re-run on ${shortSha(head)}`;

  return command.command === "memory" ? `Teach ${titleCase(bot)}…` : command.label;
};

const titleOf = (command: BotCommand, bot: string) =>
  command.command === "memory"
    ? `What should ${titleCase(bot)} remember?`
    : `Post ${command.slash}?`;

export const BotMenu = ({ bot, pull, head, viewer }: BotMenuProps) => {
  const confirmed = useBotConfirmed(bot);
  const [asking, setAsking] = useState<BotCommand | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async (command: BotCommand, note: string | null) => {
    setBusy(true);
    setError(null);
    const done = await postBotCommand(pull, bot, command.command, note);

    setBusy(false);

    if (!done.ok) {
      setAsking(command);
      setError(done.message);

      return;
    }

    confirmBot(bot);
    setAsking(null);
    setText("");
  };

  // The confirm opens once the menu has closed: its focus going back to ⋯ would dismiss it.
  const queued = useRef<BotCommand | null>(null);

  const choose = (command: BotCommand) => {
    if (confirmed && command.command !== "memory") void post(command, null);
    else queued.current = command;
  };

  const afterMenu = (event: Event) => {
    const command = queued.current;

    if (command === null) return;
    queued.current = null;
    event.preventDefault();
    setAsking(command);
  };

  const teach = asking?.command === "memory";

  return (
    <Popover open={asking !== null} onOpenChange={(open) => (open ? null : setAsking(null))}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <span className="flex">
            <DropdownMenuTrigger asChild>
              <MoreButton aria-label={`${bot} commands`} data-testid="bot-menu-trigger" />
            </DropdownMenuTrigger>
          </span>
        </PopoverAnchor>
        <DropdownMenuContent
          align="end"
          className="w-64"
          data-testid="bot-menu"
          onCloseAutoFocus={afterMenu}
        >
          {BOT_COMMANDS.map((command) => (
            <DropdownMenuItem
              key={command.command}
              data-testid={`bot-command-${command.command}`}
              onSelect={() => choose(command)}
            >
              {labelOf(command, bot, head)}
              <DropdownMenuShortcut className="font-mono">{command.slash}</DropdownMenuShortcut>
            </DropdownMenuItem>
          ))}
          <p className="border-hairline text-caption text-text-subtle mt-1 border-t px-2 pt-2 pb-1">
            Posts the command as a comment on the pull request, as {viewer}.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent align="end" className="flex w-80 flex-col gap-2.5" data-testid="bot-confirm">
        {asking !== null && (
          <>
            <PopoverTitle>{titleOf(asking, bot)}</PopoverTitle>
            <PopoverDescription>
              {teach
                ? `Posts /memory with your words on the pull request, as ${viewer}.`
                : `It goes on the pull request as a comment from ${viewer}, and ${bot} answers it there. Polaris asks this once for ${bot}.`}
            </PopoverDescription>
            {teach && (
              <Textarea
                autoFocus
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Migrations in this repo are always reviewed by a DBA"
                className="min-h-16"
              />
            )}
            {error !== null && <p className="text-caption text-failed-text">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAsking(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || (teach && text.trim() === "")}
                data-testid="bot-confirm-post"
                onClick={() => void post(asking, teach ? text.trim() : null)}
              >
                Post {asking.slash}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};

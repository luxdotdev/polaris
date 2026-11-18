/**
 * Above the composer while Comments wait unsent: how many, which to send (all by default),
 * and "Send as turn", one Turn carrying them with each author kept (`SendFeedback.commentIds`).
 */
import {
  Button,
  ChevronDownIcon,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@polaris/ui";
import { useState } from "react";
import { sendComments } from "../../data/session.ts";
import { actorName, anchorPlace, unsentComments } from "../../model/session.ts";
import { useSessionComments } from "./hooks.ts";

const count = (n: number) => `${n} ${n === 1 ? "comment" : "comments"}`;

export const SendComments = ({ hostKey, sessionId }: { hostKey: string; sessionId: string }) => {
  const scope = useSessionComments(hostKey, sessionId);
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());

  const [state, setState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });

  const unsent = unsentComments(scope.comments);

  if (!scope.shared || unsent.length === 0) return null;
  const chosen = unsent.filter((c) => !left.has(c.id));

  const toggle = (id: string, on: boolean) => {
    const next = new Set(left);

    if (on) next.delete(id);
    else next.add(id);
    setLeft(next);
  };

  const send = async () => {
    setState({ busy: true, error: null });

    const done = await sendComments(
      hostKey,
      sessionId,
      chosen.map((c) => c.id)
    );

    setState({ busy: false, error: done.ok ? null : done.message });
  };

  return (
    <div className="gap-gap flex min-w-0 items-center px-1 pb-1.5" data-testid="send-comments">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="xs" variant="ghost">
            {chosen.length === unsent.length
              ? `${count(unsent.length)} not sent`
              : `${chosen.length} of ${count(unsent.length)}`}
            <ChevronDownIcon size={10} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          {unsent.map((c) => (
            <DropdownMenuCheckboxItem
              key={c.id}
              checked={!left.has(c.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(on) => toggle(c.id, on)}
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-caption text-text-subtle truncate">
                  {actorName(c.author, scope.viewer)} {anchorPlace(c, scope.harnessName)}
                </span>
                <span className="truncate">{c.body}</span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {state.error === null ? null : (
        <span className="text-caption text-failed-text min-w-0 truncate">{state.error}</span>
      )}
      <span className="flex-1" />
      <Button
        size="xs"
        variant="secondary"
        disabled={state.busy || chosen.length === 0}
        onClick={() => void send()}
        data-testid="send-comments-turn"
      >
        Send as turn
      </Button>
    </div>
  );
};

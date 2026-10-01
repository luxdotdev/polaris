/**
 * An Agent Session's prompts for the Turns under review (Paper R9 CS2-0), newest first,
 * above its walkthrough: Agent Sessions have no description.
 */
import { count } from "../model/copy.ts";
import type { TurnPromptView } from "../model/types.ts";
import { Card, CardHead, TextAction } from "./parts.tsx";

export interface PromptsProps {
  readonly prompts: ReadonlyArray<TurnPromptView>;
  /** "Claude Code on MacBook Pro". */
  readonly where: string;
  readonly onOpenSession: () => void;
}

export const Prompts = ({ prompts, where, onOpenSession }: PromptsProps) => {
  const newest = [...prompts].sort((a, b) => b.turnIndex - a.turnIndex);

  return (
    <Card data-testid="session-prompts">
      <CardHead ruled>
        <span className="text-body text-text-strong font-medium">What you asked</span>
        <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">
          {[`${count(prompts.length, "prompt")} since your last review`, where]
            .filter((p) => p !== "")
            .join(" · ")}
        </span>
        <TextAction onClick={onOpenSession}>Open session</TextAction>
      </CardHead>
      <ol className="px-panel flex flex-col gap-2.5 py-3">
        {newest.map((p) => (
          <li key={p.turnIndex} className="gap-panel flex items-start">
            <span className="text-body text-text-subtle tabular w-14 shrink-0">
              Turn {p.turnIndex + 1}
            </span>
            <q className="text-body text-text-default line-clamp-3 min-w-0 flex-1">{p.prompt}</q>
            <span className="text-caption text-text-subtle tabular shrink-0 pt-px">
              {count(p.files, "file")}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
};

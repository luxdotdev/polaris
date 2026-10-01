/**
 * "Publish as description" on the viewer's own pull request (Paper R9 D6Z-0): never
 * automatic, never on someone else's. The popover says what it replaces and previews it.
 */
import {
  Button,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@polaris/ui";
import { useState } from "react";
import type { OpenPull } from "../../../../../shared/api.ts";
import { publishDescription } from "../data/actions.ts";
import type { PublishOffer } from "../model/publish.ts";

export interface PublishProps {
  readonly offer: Exclude<PublishOffer, null>;
  readonly pull: Pick<OpenPull, "repo" | "number">;
  readonly pullId: string;
  readonly viewer: string;
  readonly head: string;
  /** The current description: empty, or what it replaces. */
  readonly current: string;
  readonly body: string;
}

export const PublishButton = ({
  offer,
  pull,
  pullId,
  viewer,
  head,
  current,
  body,
}: PublishProps) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = offer === "publish" ? "Publish as description" : "Republish";

  const publish = async () => {
    setBusy(true);
    setError(null);
    const done = await publishDescription(pull, pullId, body, head);

    setBusy(false);

    if (done.ok) setOpen(false);
    else setError(done.message);
  };

  const replaces =
    current.trim() === ""
      ? "The description is empty now, so nothing is replaced."
      : "It replaces the current description.";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="xs" data-testid="publish-description">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-[380px] flex-col gap-2.5"
        data-testid="publish-confirm"
      >
        <PopoverTitle>Publish the walkthrough as the description?</PopoverTitle>
        <PopoverDescription>
          It becomes the body of #{pull.number} on GitHub, as {viewer}. {replaces} It doesn’t update
          itself later; publish again after new commits.
        </PopoverDescription>
        <pre className="bg-surface-sunken rounded-control text-code-inline text-text-default max-h-28 overflow-hidden px-3 py-2 font-mono whitespace-pre-wrap">
          {body.split("\n").slice(0, 6).join("\n")}
        </pre>
        {error !== null && <p className="text-caption text-failed-text">{error}</p>}
        <div className="flex items-center gap-2">
          <span className="text-caption text-text-subtle flex-1">
            Finding links become file links
          </span>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void publish()}>
            {offer === "publish" ? "Publish" : "Republish"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

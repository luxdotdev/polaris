/**
 * "Review a PR by URL": any pull request on github.com, matched to a Workspace or not
 * (ENG-185). Pasting a URL and ↵ opens it in Review.
 */
import { Input, Popover, PopoverContent, PopoverDescription, PopoverTrigger } from "@polaris/ui";
import { useState } from "react";
import { parsePullUrl } from "../../../../shared/github.ts";
import type { OpenPull } from "../../../../shared/api.ts";
import { LinkGlyph } from "./glyphs.tsx";

export interface ByUrlProps {
  readonly onOpen: (pull: OpenPull) => void;
}

export const ByUrl = ({ onOpen }: ByUrlProps) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = () => {
    const pull = parsePullUrl(text);

    if (pull === null) {
      setInvalid(true);

      return;
    }

    setOpen(false);
    setText("");
    onOpen({ ...pull, pullId: null });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setInvalid(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="review-by-url"
          className="rounded-control border-hairline bg-surface-raised text-label text-text-default hover:bg-fill-hover flex h-[30px] shrink-0 cursor-default items-center gap-2 border px-3 font-medium"
        >
          <span className="text-text-subtle">
            <LinkGlyph />
          </span>
          Review a PR by URL
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-[360px] flex-col gap-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            data-testid="review-by-url-input"
            aria-label="Pull request URL"
            aria-invalid={invalid}
            placeholder="https://github.com/owner/repo/pull/123"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setInvalid(false);
            }}
            className="font-mono"
          />
        </form>
        <PopoverDescription>
          {invalid
            ? "That isn’t a pull request on github.com. Paste its URL, ending in /pull/ and a number."
            : "Any pull request on github.com, even one no workspace points at. ↵ opens it."}
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  );
};

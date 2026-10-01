/**
 * Settings → Sessions → Working verbs (DESIGN.md, Working strip): the list the
 * strip rotates through for every Harness, edited in place (add, remove,
 * reset). Claude Code sessions follow `spinnerVerbs` from Claude Code's own
 * settings first, as Claude Code does.
 */
import { Button, CloseIcon, IconButton, Input } from "@polaris/ui";
import { useState } from "react";
import {
  addVerb,
  cleanVerb,
  editableVerbs,
  MAX_VERBS,
  removeVerb,
} from "../../session/verbs/index.ts";
import { setSessionPrefs, useSettings } from "../store.ts";
import { FooterStrip, Group } from "./parts.tsx";

const save = (verbs: ReadonlyArray<string>) => setSessionPrefs({ spinnerVerbs: [...verbs] });

const AddVerb = ({ app }: { readonly app: ReadonlyArray<string> | null }) => {
  const [draft, setDraft] = useState("");
  const verbs = editableVerbs(app);
  const next = addVerb(app, draft);
  const adds = cleanVerb(draft) !== "" && next.length > verbs.length;

  const add = () => {
    if (!adds) return;
    save(next);
    setDraft("");
  };

  return (
    <form
      className="px-panel flex items-center gap-3 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <Input
        aria-label="New verb"
        className="flex-1"
        placeholder="Reticulating splines…"
        value={draft}
        maxLength={120}
        onChange={(event) => setDraft(event.target.value)}
        data-testid="verb-input"
      />
      <Button type="submit" disabled={!adds || verbs.length >= MAX_VERBS}>
        Add
      </Button>
    </form>
  );
};

export const WorkingVerbs = () => {
  const app = useSettings((s) => s.sessions.spinnerVerbs);
  const verbs = editableVerbs(app);

  return (
    <Group label="Working verbs">
      <div className="px-panel flex flex-col gap-2.5 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-label text-text-strong">Working verbs</span>
          <span className="text-caption text-text-subtle">
            The Working strip shows one at a time while a turn runs, a new one every few seconds
          </span>
        </div>
        <ul className="flex flex-wrap gap-1.5" aria-label="Verbs" data-testid="verb-list">
          {verbs.map((verb, index) => (
            <li
              key={verb}
              className="rounded-control border-hairline text-caption text-text-default flex h-7 items-center gap-0.5 border pr-0.5 pl-2.5"
            >
              {verb}
              <IconButton
                size="sm"
                label={`Remove ${verb}`}
                disabled={verbs.length === 1}
                icon={<CloseIcon size={10} />}
                onClick={() => save(removeVerb(app, index))}
              />
            </li>
          ))}
        </ul>
      </div>
      <AddVerb app={app} />
      <FooterStrip>
        <span className="text-caption text-text-subtle flex-1">
          Claude Code sessions use <code className="text-code-inline font-mono">spinnerVerbs</code>{" "}
          from Claude Code&apos;s settings first
        </span>
        {app === null ? null : (
          <Button variant="ghost" size="xs" onClick={() => setSessionPrefs({ spinnerVerbs: null })}>
            Reset to the built-in verbs
          </Button>
        )}
      </FooterStrip>
    </Group>
  );
};

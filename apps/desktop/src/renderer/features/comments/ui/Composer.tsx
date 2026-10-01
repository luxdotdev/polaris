/**
 * The comment composer under the selected lines (Paper R6 8NC-0, R8): the range, who it
 * goes to, the text, Suggest change and the linked finding, then Cancel, the send-at-once
 * action and the one that batches ("Add to review ⌘↵" / "Add to feedback ⌘↵").
 */
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  harnessHue,
  SeverityGlyph,
  Textarea,
} from "@polaris/ui";
import { useStore } from "zustand";
import { ANNOTATION_INSET, emptySurface, surfaceStore } from "../../review/index.ts";
import {
  addToFeedback,
  addToReview,
  closeComposer,
  commentNow,
  type Done,
  sendNow,
} from "../data/actions.ts";
import { type ComposerState, patchComposer, useComments } from "../data/store.ts";
import { pendingCount } from "../model/threads.ts";
import { anchorLabel, suggestionBlock } from "../model/composer.ts";
import { useSessionHarness } from "./hooks.ts";

interface Props {
  readonly subjectKey: string;
}

const useFindings = (subjectKey: string) =>
  useStore(surfaceStore, (s) => (s[subjectKey] ?? emptySurface).findings);

/** Who the comment goes to: the GitHub account, or the session's Harness and next Turn. */
const useDestination = (subjectKey: string, kind: "pull" | "session") => {
  const login = useComments((s) => s.pulls[subjectKey]?.detail?.viewerLogin ?? null);
  const session = useComments((s) => s.sessions[subjectKey]);

  const harness = useSessionHarness(subjectKey);

  if (kind === "pull") return login === null ? null : `as ${login}`;

  return session === undefined
    ? null
    : `Goes to ${harness === null ? "the session" : harnessHue(harness).name} with turn ${session.nextTurn}`;
};

const FindingLink = ({ subjectKey, composer }: Props & { readonly composer: ComposerState }) => {
  const findings = useFindings(subjectKey);
  const linked = findings.find((f) => f.id === composer.findingId);
  const here = findings.filter((f) => f.path === composer.anchor.path && f.status === "open");
  const choices = here.length > 0 ? here : findings.filter((f) => f.status === "open");

  if (linked !== undefined) {
    return (
      <Button
        size="xs"
        variant="secondary"
        className="max-w-56 min-w-0"
        title="Unlink this finding"
        onClick={() => patchComposer(subjectKey, { findingId: null })}
      >
        <SeverityGlyph severity={linked.severity} tone="text" />
        <span className="truncate">{linked.title}</span>
      </Button>
    );
  }

  if (choices.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="ghost" className="border-hairline border border-dashed">
          Link a finding
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {choices.map((f) => (
          <DropdownMenuItem
            key={f.id}
            onSelect={() => patchComposer(subjectKey, { findingId: f.id })}
          >
            <SeverityGlyph severity={f.severity} tone="text" />
            <span className="truncate">{f.title}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const Actions = ({ subjectKey, composer }: Props & { readonly composer: ComposerState }) => {
  const kind = subjectKey.startsWith("pull:") ? "pull" : "session";
  const pending = useComments((s) => pendingCount(s.pulls[subjectKey]?.detail ?? null));
  const empty = composer.text.trim() === "";
  const run = (action: (key: string) => Promise<Done>) => () => void action(subjectKey);

  return (
    <div className="border-hairline pr-gap py-gap flex items-center gap-1.5 border-t pl-3">
      <Button
        size="xs"
        variant="secondary"
        disabled={composer.anchor.code === ""}
        onClick={() =>
          patchComposer(subjectKey, {
            text: `${composer.text}${composer.text === "" ? "" : "\n"}${suggestionBlock(composer.anchor.code)}`,
          })
        }
      >
        Suggest change
      </Button>
      <FindingLink subjectKey={subjectKey} composer={composer} />
      <span className="flex-1" />
      <Button size="sm" variant="ghost" onClick={() => closeComposer(subjectKey)}>
        Cancel <span className="text-text-subtle font-regular">esc</span>
      </Button>
      {kind === "session" ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={empty || composer.busy}
          onClick={run(sendNow)}
        >
          Send now
        </Button>
      ) : (
        composer.moving === null && (
          <Button
            size="sm"
            variant="secondary"
            disabled={empty || composer.busy}
            title={
              pending === 0
                ? "Publish this comment now"
                : `Publishes your ${pending} pending ${pending === 1 ? "comment" : "comments"} with it`
            }
            onClick={run(commentNow)}
          >
            Comment now
          </Button>
        )
      )}
      <Button
        size="sm"
        variant="primary"
        disabled={empty || composer.busy}
        data-testid="composer-add"
        onClick={run(kind === "pull" ? addToReview : addToFeedback)}
      >
        {kind === "pull" ? "Add to review" : "Add to feedback"}
        <span className="opacity-60">⌘↵</span>
      </Button>
    </div>
  );
};

export const Composer = ({ subjectKey }: Props) => {
  const composer = useComments((s) => s.composers[subjectKey]);
  const kind = subjectKey.startsWith("pull:") ? "pull" : "session";
  const destination = useDestination(subjectKey, kind);

  if (composer === undefined) return null;

  const primary = kind === "pull" ? addToReview : addToFeedback;

  return (
    <div className={cn("py-gap flex font-sans", ANNOTATION_INSET)} data-testid="comment-composer">
      <div
        className={cn(
          "rounded-row bg-surface-raised border-hairline flex min-w-0 flex-1 flex-col border",
          "shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-starlight)_35%,transparent)]"
        )}
      >
        <div className="pt-row-x gap-gap flex items-center px-3">
          <span className="text-text-subtle font-mono text-[11px] leading-4">
            {anchorLabel(composer.anchor)}
            {composer.moving === null ? "" : " · moving an outdated draft here"}
          </span>
          <span className="flex-1" />
          {destination !== null && (
            <span className="text-caption text-text-subtle">{destination}</span>
          )}
        </div>
        <div className="pt-gap px-3 pb-3">
          <Textarea
            bare
            autoFocus
            rows={2}
            aria-label="Comment"
            data-testid="composer-text"
            className="max-h-72 min-h-10"
            placeholder={kind === "pull" ? "Leave a comment" : "Tell the agent what to change"}
            value={composer.text}
            onChange={(event) => patchComposer(subjectKey, { text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeComposer(subjectKey);
              } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void primary(subjectKey);
              }
            }}
          />
          {composer.error !== null && (
            <p className="text-caption text-failed-text pt-1">{composer.error}</p>
          )}
        </div>
        <Actions subjectKey={subjectKey} composer={composer} />
      </div>
    </div>
  );
};

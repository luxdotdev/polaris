/**
 * "Ask the reviewer" at the foot of the risk column (Paper R1 1YD-0): a question about the
 * whole change, or the finding "Ask about this" picked. It continues the Reviewer's own
 * read-only session; the answer shows here, and findings it changes reach the summary.
 */
import type { SessionId, TurnId } from "@polaris/protocol";
import {
  ArrowUpIcon,
  Button,
  CloseIcon,
  Dither,
  PixelPolarisIcon,
  SeverityGlyph,
} from "@polaris/ui";
import { Predicate } from "effect";
import { useState } from "react";
import { useSession } from "../../session/hooks.ts";
import { type Ask, askReviewer, useAsks } from "../data/actions.ts";
import { setAskAbout, useAskAbout } from "../data/ui.ts";
import { answerOf, type TurnSnapshot } from "../model/answer.ts";
import type { Summary } from "../model/summary.ts";

const isMessage = Predicate.isTagged("AssistantMessage");

const useTurn = (hostKey: string, sessionId: SessionId, turnId: TurnId): TurnSnapshot | null => {
  const model = useSession(hostKey, sessionId);
  const view = model.turns.find((t) => t.turn.id === turnId);

  if (view === undefined) return null;
  const messages: Array<string> = [];

  for (const item of view.items) if (isMessage(item)) messages.push(item.text);

  for (const live of view.live.values()) {
    if (live.item !== null && isMessage(live.item)) messages.push(live.text);
  }

  return { status: view.turn.status, messages };
};

const Answer = ({
  hostKey,
  sessionId,
  turnId,
}: {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
}) => {
  const answer = answerOf(useTurn(hostKey, sessionId, turnId));

  if (answer.kind === "thinking") {
    return (
      <span className="text-caption text-text-subtle gap-gap flex items-center">
        <Dither hue="starlight" size={12} moving />
        The reviewer is looking…
      </span>
    );
  }

  return (
    <p
      className={
        answer.kind === "failed"
          ? "text-caption text-failed-text"
          : "text-caption text-text-default whitespace-pre-wrap"
      }
    >
      {answer.text}
    </p>
  );
};

const AskItem = ({
  hostKey,
  ask,
  summary,
}: {
  readonly hostKey: string;
  readonly ask: Ask;
  readonly summary: Summary;
}) => {
  const about = summary.findings.find((f) => f.id === ask.findingId);

  return (
    <div className="flex flex-col gap-1" data-testid="reviewer-ask">
      <p className="text-caption text-text-subtle">
        {about !== undefined && <span className="text-text-subtle">On “{about.title}”: </span>}
        {ask.question}
      </p>
      {ask.state.kind === "sending" && (
        <span className="text-caption text-text-subtle">Asking…</span>
      )}
      {ask.state.kind === "failed" && (
        <p className="text-caption text-failed-text">{ask.state.message}</p>
      )}
      {ask.state.kind === "sent" && (
        <Answer hostKey={hostKey} sessionId={ask.state.sessionId} turnId={ask.state.turnId} />
      )}
    </div>
  );
};

const placeholderOf = (canAsk: boolean, aboutFinding: boolean) => {
  if (!canAsk) return "No reviewer ran: rules only";

  return aboutFinding ? "Ask about this finding" : "Ask the reviewer about this change";
};

export interface AskReviewerProps {
  readonly subjectKey: string;
  readonly hostKey: string;
  readonly summary: Summary;
}

export const AskReviewer = ({ subjectKey, hostKey, summary }: AskReviewerProps) => {
  const asks = useAsks(summary.id);
  const aboutId = useAskAbout(subjectKey);
  const about = summary.findings.find((f) => f.id === aboutId) ?? null;
  const [question, setQuestion] = useState("");
  const canAsk = summary.reviewer !== null && summary.reviewer.sessionId !== null;

  const ask = () => {
    if (question.trim() === "" || !canAsk) return;
    void askReviewer(hostKey, summary.id, about?.id ?? null, question);
    setQuestion("");
    setAskAbout(subjectKey, null);
  };

  return (
    <div className="flex flex-col gap-2 px-3 pt-2 pb-3" data-testid="ask-reviewer">
      {asks.slice(-2).map((a) => (
        <AskItem key={a.id} hostKey={hostKey} ask={a} summary={summary} />
      ))}
      {about !== null && (
        <div className="gap-gap text-caption text-text-subtle flex items-center">
          <SeverityGlyph severity={about.severity} tone="text" />
          <span className="min-w-0 flex-1 truncate">About “{about.title}”</span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Ask about the whole change"
            onClick={() => setAskAbout(subjectKey, null)}
          >
            <CloseIcon size={12} />
          </Button>
        </div>
      )}
      <div className="rounded-card bg-surface-raised border-hairline pl-row-x gap-gap flex h-10 items-center border pr-1.5">
        <PixelPolarisIcon size={16} className="text-starlight shrink-0" />
        <input
          aria-label="Ask the reviewer"
          data-testid="ask-input"
          disabled={!canAsk}
          className="text-body text-text-default placeholder:text-text-faint min-w-0 flex-1 bg-transparent outline-none"
          placeholder={placeholderOf(canAsk, about !== null)}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask();
          }}
        />
        <Button
          size="icon-sm"
          variant="secondary"
          className="rounded-full"
          aria-label="Ask"
          disabled={!canAsk || question.trim() === ""}
          onClick={ask}
        >
          <ArrowUpIcon size={12} />
        </Button>
      </div>
    </div>
  );
};

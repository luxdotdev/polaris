/**
 * "Message the lead about this" (spec §5, Authority): a note to the Lead that either asks for
 * a recommendation or lets it decide. "Add a task" reuses it as plain conversation.
 */
import { type ConstellationId, type MessageAuthority, MessageTarget } from "@polaris/protocol";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from "@polaris/ui";
import { useState } from "react";
import { constellationCommands } from "../client.ts";

export interface MessageDraft {
  readonly title: string;
  readonly authority: MessageAuthority;
  readonly text: string;
}

const EXPLAIN: Readonly<Record<MessageAuthority, string>> = {
  conversation: "The lead reads it in its next turn.",
  recommend_and_return: "The lead recommends what to do and waits for you.",
  may_decide_and_continue: "The lead may decide and carry on.",
};

const Body = ({
  draft,
  onSend,
  onClose,
}: {
  readonly draft: MessageDraft;
  readonly onSend: (text: string) => void;
  readonly onClose: () => void;
}) => {
  const [text, setText] = useState(draft.text);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{draft.title}</DialogTitle>
        <DialogDescription>{EXPLAIN[draft.authority]}</DialogDescription>
      </DialogHeader>
      <div className="px-5 pb-4">
        <Textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          aria-label="Message"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() !== "") onSend(text);
          }}
        />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={text.trim() === ""} onClick={() => onSend(text)}>
          Send to the lead
        </Button>
      </DialogFooter>
    </>
  );
};

export const MessageLeadDialog = ({
  hostKey,
  constellationId,
  draft,
  onClose,
}: {
  readonly hostKey: string;
  readonly constellationId: ConstellationId;
  readonly draft: MessageDraft | null;
  readonly onClose: () => void;
}) => {
  const send = (text: string) => {
    if (draft === null) return;
    onClose();
    void constellationCommands.message(
      hostKey,
      {
        constellationId,
        target: MessageTarget.cases.Lead.make({}),
        text: text.trim(),
        authority: draft.authority,
      },
      "Couldn't message the lead"
    );
  };

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        {draft === null ? null : (
          <Body key={draft.title} draft={draft} onSend={send} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
};

/** Answer a question an Agent Session asked: one of its choices, or your own words. */
import { Action, ActionPanel, Form, useNavigation } from "@raycast/api";
import type { ApprovalRequest } from "@polaris/sdk";
import { useState } from "react";
import { usePolaris } from "../polaris.tsx";
import type { SessionRow } from "../lib/rows.ts";
import { attempt } from "./toast.ts";

const OWN = "";

export const AnswerForm = (props: {
  readonly row: SessionRow;
  readonly question: ApprovalRequest;
}) => {
  const { client } = usePolaris();
  const { pop } = useNavigation();
  const [choice, setChoice] = useState(props.question.options[0] ?? OWN);
  const [error, setError] = useState<string | undefined>();
  const { hostId, hostName, entry } = props.row;

  const submit = async (values: { readonly text?: string }) => {
    const text = choice === OWN ? (values.text ?? "").trim() : choice;

    if (text === "") return setError("Write an answer first");

    const sent = await attempt(
      { progress: "Answering…", done: "Answer sent", action: "send the answer", hostName },
      () =>
        client.respondToApproval(hostId, entry.session.id, props.question.id, {
          kind: "answer",
          text,
        })
    );

    if (sent) pop();
  };

  return (
    <Form
      navigationTitle={entry.session.title}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send Answer" onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Description title="Question" text={props.question.title} />
      {props.question.detail === null ? null : <Form.Description text={props.question.detail} />}
      {props.question.options.length === 0 ? null : (
        <Form.Dropdown id="choice" title="Answer" value={choice} onChange={setChoice}>
          {props.question.options.map((option) => (
            <Form.Dropdown.Item key={option} title={option} value={option} />
          ))}
          <Form.Dropdown.Item title="My own answer" value={OWN} />
        </Form.Dropdown>
      )}
      {choice === OWN ? (
        <Form.TextArea
          id="text"
          title="Your answer"
          {...(error === undefined ? {} : { error: error })}
          onChange={() => setError(undefined)}
        />
      ) : null}
    </Form>
  );
};

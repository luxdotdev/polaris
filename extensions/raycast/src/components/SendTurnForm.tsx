/** Send a Turn to an Agent Session. */
import { Action, ActionPanel, Form, useNavigation } from "@raycast/api";
import { useState } from "react";
import { usePolaris } from "../polaris.tsx";
import type { SessionRow } from "../lib/rows.ts";
import { attempt } from "./toast.ts";

export const SendTurnForm = (props: { readonly row: SessionRow }) => {
  const { client } = usePolaris();
  const { pop } = useNavigation();
  const [error, setError] = useState<string | undefined>();
  const { hostId, hostName, entry } = props.row;

  const submit = async (values: { readonly prompt: string }) => {
    const prompt = values.prompt.trim();

    if (prompt === "") return setError("Write the turn first");

    const sent = await attempt(
      { progress: "Sending turn…", done: "Turn sent", action: "send the turn", hostName },
      () => client.sendTurn(hostId, entry.session.id, prompt)
    );

    if (sent) pop();
  };

  return (
    <Form
      navigationTitle={entry.session.title}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send Turn" onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="prompt"
        title="Turn"
        placeholder={`To ${entry.session.title}`}
        {...(error === undefined ? {} : { error: error })}
        onChange={() => setError(undefined)}
      />
    </Form>
  );
};

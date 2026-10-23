/** Paste a pairing string from Polaris (Settings → Extensions) and keep it in LocalStorage. */
import {
  Action,
  ActionPanel,
  Form,
  LocalStorage,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { InvalidPairing } from "@polaris/sdk";
import { useState } from "react";
import { addPairing } from "../lib/pairings.ts";

export const AddPairingForm = (props: { readonly onAdded: () => void }) => {
  const { pop } = useNavigation();
  const [error, setError] = useState<string | undefined>();

  const submit = async (values: { readonly pairing: string }) => {
    try {
      const { added, replaced } = await addPairing(LocalStorage, values.pairing);

      await showToast({
        style: Toast.Style.Success,
        title: replaced
          ? `Pairing replaced for ${added.pairing.hostName}`
          : `Paired with ${added.pairing.hostName}`,
      });
      props.onAdded();
      pop();
    } catch (failure) {
      if (failure instanceof InvalidPairing) setError(`Not a pairing string: ${failure.reason}`);
      else throw failure;
    }
  };

  return (
    <Form
      navigationTitle="Add Pairing"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Add Pairing" onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Description text="In Polaris, open Settings → Extensions, pair Raycast, and copy the pairing string it shows once." />
      <Form.TextArea
        id="pairing"
        title="Pairing string"
        placeholder="polaris-pair:v1:…"
        {...(error === undefined ? {} : { error: error })}
        onChange={() => setError(undefined)}
      />
      <Form.Description text="The pairing string is a secret. Raycast keeps it on this Mac." />
    </Form>
  );
};

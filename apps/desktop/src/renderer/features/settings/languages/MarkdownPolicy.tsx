import * as P from "@polaris/protocol";
import { Button } from "@polaris/ui";
import { Schema } from "effect";
import { useLayoutEffect, useState } from "react";
import type { LanguageApi } from "../../../../shared/api.ts";
import { Group } from "../ui/parts.tsx";
import { Choice, FormBlock } from "./fields.tsx";
import type { MarkdownPolicyRefresh, RegisteredLanguageCheckout } from "./integrationContracts.ts";
import { updateMarkdownPolicy } from "./policy.ts";

export const MarkdownPolicy = ({
  api,
  selected,
  hostId,
  hook,
  disabled,
  authority,
}: {
  readonly api: LanguageApi | undefined;
  readonly selected: RegisteredLanguageCheckout;
  readonly hostId: P.HostId;
  readonly hook: MarkdownPolicyRefresh | null;
  readonly disabled: boolean;
  readonly authority: object;
}) => {
  const [policy, setPolicy] = useState<P.LanguagePreviewPolicy | null>(null);
  const [notice, setNotice] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lifetime, setLifetime] = useState(() => new AbortController());
  const workspaceId = selected.checkout.workspaceId;
  const hostKey = selected.hostKey;
  useLayoutEffect(() => {
    const controller = new AbortController();
    setLifetime(controller);
    setPolicy(null);
    setBusy(true);
    setNotice("");

    if (!api || disabled) {
      setBusy(false);

      return () => controller.abort();
    }

    void api
      .request("languages.preview.policy.get", { hostKey, workspaceId })
      .then((result) => {
        if (controller.signal.aborted) return;
        setBusy(false);

        if (!result.ok) {
          setNotice("Preview policy unavailable. Source and sanitized preview remain available.");

          return;
        }

        const valid = Schema.decodeUnknownSync(P.LanguagePreviewPolicy)(result.value);

        if (valid.hostId !== hostId || valid.workspaceId !== workspaceId) {
          setNotice("Preview policy belongs to another workspace.");

          return;
        }

        setPolicy(valid);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBusy(false);
          setNotice("Couldn't read preview policy. Refresh to retry.");
        }
      });

    return () => controller.abort();
  }, [api, hostId, hostKey, workspaceId, epoch, disabled, authority, hook]);

  return (
    <Group label="Markdown preview">
      <FormBlock>
        <p className="text-label">External images · {selected.label}</p>
        <p className="text-caption text-text-subtle">
          Source and sanitized preview stay available. Scripts remain disabled.
        </p>
        {!hook && (
          <p className="text-caption">
            Preview policy changes are unavailable until the preview service is connected.
          </p>
        )}
        {notice && (
          <p role="status" className="text-caption">
            {notice}
          </p>
        )}
        <Choice
          label="External images"
          value={policy?.externalImages ?? "ask"}
          disabled={disabled || busy || !policy || !hook}
          onChange={(value) => {
            if (!api || !hook || !policy) return;

            const externalImages = Schema.decodeUnknownSync(
              P.LanguagePreviewPolicy.fields.externalImages
            )(value);

            setBusy(true);
            void updateMarkdownPolicy(
              api,
              hook,
              hostKey,
              { ...policy, externalImages },
              lifetime.signal
            ).then((result) => {
              if (lifetime.signal.aborted) return;
              setBusy(false);

              if (result.ok) {
                setPolicy(result.value);
                setNotice("Preview policy saved.");
              } else {
                setPolicy(null);
                setNotice(result.message);
              }
            });
          }}
        >
          <option value="ask">Ask before loading</option>
          <option value="allow">Allow external images</option>
          <option value="deny">Block external images</option>
        </Choice>
        <Button disabled={busy || disabled} onClick={() => setEpoch((value) => value + 1)}>
          Refresh preview policy
        </Button>
      </FormBlock>
    </Group>
  );
};

import { lazy, Suspense, useEffect, useState } from "react";
import { Schema } from "effect";
import { LanguagePreviewPolicy } from "@polaris/protocol";
import type { LanguageApi } from "../../../../shared/api.ts";
import type { RenderedProps } from "./Rendered.tsx";
import { PreviewBoundary } from "./Boundary.tsx";
import { PreviewMediaPool } from "./media.ts";
import "./preview.css";

const Rendered = lazy(() => import("./Rendered.tsx"));

export type MarkdownPreviewProps = Omit<RenderedProps, "pool"> & {
  readonly api?: LanguageApi | undefined;
  readonly hostLabel: string;
};

/** Standalone view of current unsaved source; M2 owns tab and buffer coordination. */
const Preview = ({ api, hostLabel, ...props }: MarkdownPreviewProps) => {
  const [policy, setPolicy] = useState<LanguagePreviewPolicy | null>(null);
  const [pool, setPool] = useState<PreviewMediaPool | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [document] = useState(() => props.document);
  useEffect(() => {
    let stopped = false;
    setPolicy(null);
    setNotice(null);

    if (api === undefined) return;
    void api
      .request("languages.preview.policy.get", {
        hostKey: document.hostKey,
        workspaceId: document.checkout.workspaceId,
      })
      .then((result) => {
        if (!result.ok) throw new Error("Policy unavailable");
        const decoded = Schema.decodeUnknownSync(LanguagePreviewPolicy)(result.value);

        if (
          decoded.hostId !== document.hostId ||
          decoded.workspaceId !== document.checkout.workspaceId
        )
          throw new Error("Workspace mismatch");

        if (!stopped) setPolicy(decoded);
      })
      .catch(() => {
        if (!stopped) setNotice("Images unavailable on this host");
      });

    return () => {
      stopped = true;
    };
  }, [api, document.hostKey, document.hostId, document.checkout.workspaceId]);
  useEffect(() => {
    if (api === undefined || policy === null) {
      setPool(null);

      return;
    }

    const next = new PreviewMediaPool(api, document, policy);
    setPool(next);

    return () => next.dispose();
  }, [api, document, policy]);

  const allow = async () => {
    if (api === undefined || policy === null) return;
    setSaving(true);

    try {
      const result = await api.request("languages.preview.policy.set", {
        hostKey: document.hostKey,
        policy: LanguagePreviewPolicy.make({ ...policy, externalImages: "allow" }),
      });

      if (!result.ok) throw new Error("Consent unavailable");
      const decoded = Schema.decodeUnknownSync(LanguagePreviewPolicy)(result.value);

      if (decoded.hostId !== policy.hostId || decoded.workspaceId !== policy.workspaceId)
        throw new Error("Policy mismatch");
      setPolicy(decoded);
      setNotice(null);
    } catch {
      setNotice("Couldn’t remember external image choice");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="markdown-preview" aria-label={`Markdown preview on ${hostLabel}`}>
      <div className="preview-policy">
        {policy?.externalImages === "ask" && (
          <button type="button" disabled={saving} onClick={() => void allow()}>
            Load external images
          </button>
        )}
        {policy?.externalImages === "deny" && <span>External images blocked</span>}
        {notice && <span role="status">{notice}</span>}
        {api === undefined && <span>Images unavailable on {hostLabel}</span>}
      </div>
      <PreviewBoundary source={props.source}>
        <Suspense fallback={<p className="preview-source">{props.source}</p>}>
          <Rendered {...props} document={document} pool={pool} />
        </Suspense>
      </PreviewBoundary>
    </section>
  );
};

export const MarkdownPreview = (props: MarkdownPreviewProps) => (
  <Preview
    key={JSON.stringify([
      props.document.hostKey,
      props.document.hostId,
      props.document.checkout,
      props.document.path,
    ])}
    {...props}
  />
);

export { previewTarget } from "./targets.ts";

export type { PreviewDocument, PreviewTarget } from "./targets.ts";

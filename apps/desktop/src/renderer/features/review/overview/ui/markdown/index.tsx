/**
 * Review Markdown (descriptions, comments, the bot summary, the walkthrough), its own
 * chunk: until it loads the text shows plain, in the same type.
 */
import { lazy, Suspense } from "react";
import type { RenderedProps } from "./Rendered.tsx";

const Rendered = lazy(() => import("./Rendered.tsx"));

const Plain = ({ markdown }: { readonly markdown: string }) => (
  <p className="text-body text-text-default break-words whitespace-pre-wrap">{markdown}</p>
);

export const ReviewMarkdown = (props: RenderedProps) => (
  <Suspense fallback={<Plain markdown={props.markdown} />}>
    <Rendered {...props} />
  </Suspense>
);

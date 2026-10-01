/**
 * The prompt as the composer mounts it: the Lexical editor is its own chunk,
 * fetched on idle after launch; until it arrives a still stand-in in the same
 * type holds the place, so the composer never changes size.
 */
import { lazy, Suspense } from "react";
import type { PromptEditorProps } from "./PromptEditor.tsx";

const load = () => import("./PromptEditor.tsx");

const PromptEditor = lazy(load);

let preloaded = false;

/** Fetch the editor chunk when the renderer is idle; once. */
export const preloadPrompt = () => {
  if (preloaded) return;
  preloaded = true;
  requestIdleCallback(() => void load(), { timeout: 2000 });
};

const StandIn = ({
  value,
  placeholder,
}: {
  readonly value: string;
  readonly placeholder: string;
}) => (
  <div
    className={
      value === ""
        ? "text-body text-text-faint truncate"
        : "text-body text-text-default max-h-60 overflow-hidden break-words whitespace-pre-wrap"
    }
  >
    {value === "" ? placeholder : value}
  </div>
);

export const Prompt = (props: PromptEditorProps) => (
  <Suspense fallback={<StandIn value={props.value} placeholder={props.placeholder} />}>
    <PromptEditor {...props} />
  </Suspense>
);

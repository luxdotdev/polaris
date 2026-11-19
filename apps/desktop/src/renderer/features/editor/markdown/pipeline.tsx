import type { ReactNode } from "react";
import type { Components, Pipeline } from "../../session/ui/markdown/words/Markup.tsx";
import { PROSE_SCHEMA } from "../../session/ui/markdown/words/schema.ts";
import { previewHeadings } from "./headings.ts";

// Host routing (`targets.ts`) decides every link and image; sanitizing keeps relative paths for it.
export const PREVIEW_PIPELINE: Pipeline = { schema: PROSE_SCHEMA, after: [previewHeadings()] };

/** Never let raw HTML picture sources bypass the image component's media policy. */
export const SAFE_HTML_COMPONENTS: Components = {
  source: () => null,
  picture: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
};

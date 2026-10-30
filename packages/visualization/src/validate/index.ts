/** Submit-time checks on a `visualize` call: each problem carries a fix the agent can act on. */
import {
  findExternalUrl,
  findLeadingDocument,
  findNavigation,
  findViewportSizing,
} from "./scan.ts";

export { isExternalUrl } from "./scan.ts";

export type VisualizationRule =
  | "too-large"
  | "empty"
  | "title"
  | "full-document"
  | "external-url"
  | "navigation"
  | "viewport-units";

export interface VisualizationProblem {
  readonly rule: VisualizationRule;
  readonly message: string;
  readonly fix: string;
}

export interface ValidationLimits {
  readonly maxBytes: number;
  readonly titleMax: number;
}

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** Long snippets are cut so a problem stays readable in a tool result. */
const quote = (snippet: string): string =>
  JSON.stringify(snippet.length > 80 ? `${snippet.slice(0, 77)}...` : snippet);

const sizeProblems = (html: string, limits: ValidationLimits): VisualizationProblem[] => {
  if (html.trim().length === 0) {
    return [
      {
        rule: "empty",
        message: "html is empty.",
        fix: "Pass the Visualization as an HTML fragment: <style>, markup and <script>.",
      },
    ];
  }

  const bytes = utf8Bytes(html);

  if (bytes <= limits.maxBytes) return [];

  return [
    {
      rule: "too-large",
      message: `html is ${bytes} bytes; the limit is ${limits.maxBytes}.`,
      fix: "Aggregate the inlined data, build repeated markup with a small loop in your script, and keep styles terse.",
    },
  ];
};

const titleProblem = (title: string, limits: ValidationLimits): VisualizationProblem[] => {
  const trimmed = title.trim();
  const control = /\p{Cc}/u.test(title);

  if (trimmed.length > 0 && trimmed.length <= limits.titleMax && !control) return [];

  const message =
    trimmed.length === 0
      ? "title is empty."
      : control
        ? "title contains a line break or control character."
        : `title is ${trimmed.length} characters; the limit is ${limits.titleMax}.`;

  return [
    {
      rule: "title",
      message,
      fix: `Give a short one-line title (at most ${limits.titleMax} characters) naming what the Visualization shows, such as "Loan payments by rate".`,
    },
  ];
};

const contentProblems = (html: string): VisualizationProblem[] => {
  const problems: VisualizationProblem[] = [];
  const leading = findLeadingDocument(html);

  if (leading !== undefined) {
    problems.push({
      rule: "full-document",
      message: `html starts with <${leading}>; it must be a body fragment.`,
      fix: "Drop the <!doctype>, <html>, <head> and <body> wrapper and send only <style>, markup and <script>; Polaris supplies the document, its theme and the libraries.",
    });
  }

  const external = findExternalUrl(html);

  if (external !== undefined) {
    problems.push({
      rule: "external-url",
      message: `The frame has no network access, so ${quote(external)} can never load.`,
      fix: 'Inline the data as computed values and images as data: URIs, and draw in this page (no <iframe>, srcdoc, <object> or <embed>); Chart.js (Chart), D3 (d3) and the Polaris kit (pv) are already loaded. To offer a web page, use a link-styled button instead of an <a href>: <button class="pv-link" onclick="pv.openLink(\'https://example.com\')">Docs</button>. In-page #id links and data: URLs are fine.',
    });
  }

  const navigation = findNavigation(html);

  if (navigation !== undefined) {
    problems.push({
      rule: "navigation",
      message: `${quote(navigation)} would navigate the frame away or open a window, and the frame is removed if it navigates.`,
      fix: 'Remove the location, window.open, <base>, <meta http-equiv=refresh> or target=_top use; update the page in place with script, and offer an https page with <button class="pv-link" onclick="pv.openLink(\'https://example.com\')">Docs</button>.',
    });
  }

  const sizing = findViewportSizing(html);

  if (sizing !== undefined) {
    problems.push({
      rule: "viewport-units",
      message: `${quote(sizing)} sizes against the frame, which grows to fit its content, so it never settles.`,
      fix: "Use fixed px heights (a chart's container at 240-320px) or let content set the height; never vh/dvh/svh units or height: 100% on html or body.",
    });
  }

  return problems;
};

/** All the problems with a submission, in rule order; empty when it is accepted. */
export const validateWith = (
  input: { readonly title: string; readonly html: string },
  limits: ValidationLimits
): ReadonlyArray<VisualizationProblem> => {
  const size = sizeProblems(input.html, limits);

  // An empty or oversized body isn't scanned: there is nothing to fix in it until it is resized.
  return [
    ...size,
    ...titleProblem(input.title, limits),
    ...(size.length > 0 ? [] : contentProblems(input.html)),
  ];
};

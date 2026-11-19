/**
 * Words' HTML as React (ADR 0115): parsed in an inert template (nothing loads or runs), turned into
 * hast, always sanitized with the view's schema, passed through its steps, rendered with its components.
 */
import type { Root } from "hast";
import { fromDom } from "hast-util-from-dom";
import { sanitize, type Schema } from "hast-util-sanitize";
import { type Components, toJsxRuntime } from "hast-util-to-jsx-runtime";
import { memo, type ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

/** One hast step: changes the tree in place. */
export type Step = (tree: Root) => void;

export type { Components };

/** What a view does to Words' HTML: steps before sanitizing, its schema, steps after. */
export interface Pipeline {
  /** Only steps that make URLs sanitizable (file URLs, drive paths); they run on unsanitized hast. */
  readonly before?: ReadonlyArray<Step>;
  readonly schema: Schema;
  readonly after?: ReadonlyArray<Step>;
}

/** HTML as hast, from an inert template. */
export const parseHtml = (html: string): Root => {
  const template = document.createElement("template");
  template.innerHTML = html;

  // SAFETY: a DocumentFragment becomes a hast root (hast-util-from-dom maps fragments to roots).
  return fromDom(template.content) as Root;
};

/** The HTML through a pipeline, as clean hast. */
export const processHtml = (html: string, { before = [], schema, after = [] }: Pipeline): Root => {
  const tree = parseHtml(html);

  for (const step of before) step(tree);

  // SAFETY: sanitizing a root returns a root (hast-util-sanitize keeps the root node).
  const clean = sanitize(tree, schema) as Root;

  for (const step of after) step(clean);

  return clean;
};

export const toReact = (tree: Root, components: Components): ReactNode =>
  // SAFETY: with React's `jsx`, `jsxs` and `Fragment` the runtime returns React elements; its
  // declared return is the global `JSX.Element`, which the linter can't resolve.
  toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    components,
    passNode: true,
    ignoreInvalidStyle: true,
  }) as ReactNode;

/** HTML Polaris made or checked (a highlighter's escaped lines, a guarded diagram) as React. */
export const trustedHtml = (html: string): ReactNode => toReact(parseHtml(html), {});

export interface MarkupProps {
  readonly html: string;
  readonly pipeline: Pipeline;
  readonly components: Components;
}

/** One block (or a whole document); re-renders only when its HTML, pipeline or components change. */
export const Markup = memo(({ html, pipeline, components }: MarkupProps) =>
  toReact(processHtml(html, pipeline), components)
);

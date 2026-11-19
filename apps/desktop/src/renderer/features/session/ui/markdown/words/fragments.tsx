/**
 * Links inside one rendered document (footnotes and their backlinks). Sanitizing prefixes ids per
 * document (`user-content-<scope>-`): none clobbers the app's or another message's; links follow.
 */
import { Predicate } from "effect";
import type { Element, Root, RootContent } from "hast";
import type { ComponentProps } from "react";
import type { Pipeline, Step } from "./Markup.tsx";
import { PREFIX } from "./schema.ts";

/** A same-document fragment: `#name`, not the Review's own `#finding=…` and `#path=…`. */
const FRAGMENT = /^#[^=\s]+$/;

export const isFragment = (href: string | undefined): href is string =>
  href !== undefined && FRAGMENT.test(href);

const visit = (node: Root | RootContent, element: (node: Element) => void) => {
  if (node.type === "element") element(node);

  if ("children" in node) for (const child of node.children) visit(child, element);
};

/** `#fn-1` to `#<prefix>fn-1`, as sanitizing renamed the id it points at. */
const prefixFragments =
  (prefix: string): Step =>
  (tree) =>
    visit(tree, (node) => {
      const href = node.properties["href"];

      if (Predicate.isString(href) && isFragment(href) && !href.startsWith(`#${prefix}`))
        node.properties["href"] = `#${prefix}${href.slice(1)}`;
    });

/** The pipeline for one document: its ids and its fragment links under the document's own prefix. */
export const scoped = (pipeline: Pipeline, scope: string): Pipeline => {
  const prefix = `${PREFIX}${scope.replaceAll(/[^\w-]/g, "")}-`;

  return {
    ...pipeline,
    schema: { ...pipeline.schema, clobberPrefix: prefix },
    after: [...(pipeline.after ?? []), prefixFragments(prefix)],
  };
};

/** Scrolls to its target inside the same rendered Markdown; the app's own hash route stays. */
export const FragmentLink = ({ href, id, children, className }: ComponentProps<"a">) => (
  <a
    href={href}
    id={id}
    className={className}
    onClick={(event) => {
      event.preventDefault();
      const name = (href ?? "").slice(1);
      const root = event.currentTarget.closest(".polaris-md");

      const target = Array.from(root?.querySelectorAll<HTMLElement>("[id]") ?? []).find(
        (element) => element.id === name
      );

      target?.scrollIntoView({ behavior: "instant", block: "nearest" });
    }}
  >
    {children}
  </a>
);

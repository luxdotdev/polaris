/**
 * The 32px breadcrumb row (DESIGN.md, Editor: breadcrumbs; Paper E1): the
 * path from the Workspace's root in `caption` `text-subtle`, the file and the
 * symbol at the cursor in `text-default`, and the "Ask about this file ⌘I" hint.
 */
import { Kbd } from "@polaris/ui";
import { Fragment, useMemo } from "react";
import { symbolAt } from "../cm/symbol.ts";
import { fileKey } from "../model/drafts.ts";
import { crumbs } from "../model/paths.ts";
import { useEditor } from "../runtime/store.ts";

export interface BreadcrumbsProps {
  readonly path: string;
  readonly root: string;
}

const useSymbol = (path: string) => {
  const view = useEditor((s) => (s.active?.path === path ? s.active.view : null));
  const head = useEditor((s) => (s.active?.path === path ? s.cursor : null));

  const grammar = useEditor((s) =>
    s.active === null ? false : (s.buffers[fileKey(s.active.hostKey, path)]?.grammar ?? false)
  );

  return useMemo(
    () =>
      view === null || head === null || !grammar
        ? null
        : symbolAt(view.state, view.state.selection.main.head),
    [view, head, grammar]
  );
};

export const Breadcrumbs = ({ path, root }: BreadcrumbsProps) => {
  const parts = crumbs(path, root);
  const symbol = useSymbol(path);

  return (
    <div className="text-caption text-text-subtle flex h-8 shrink-0 items-center gap-1.5 pr-4 pl-5">
      <nav
        aria-label="Path"
        className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap"
      >
        {parts.map((part, i) => (
          <Fragment key={`${i}-${part}`}>
            {i > 0 ? <span aria-hidden="true">/</span> : null}
            <span className={i === parts.length - 1 ? "text-text-default" : "truncate"}>
              {part}
            </span>
          </Fragment>
        ))}
        {symbol === null ? null : (
          <>
            <span aria-hidden="true">›</span>
            <span className="text-text-default truncate">{symbol}</span>
          </>
        )}
      </nav>
      <span className="flex-1" />
      <span className="flex shrink-0 items-center gap-1.5">
        Ask about this file
        <Kbd>⌘I</Kbd>
      </span>
    </div>
  );
};

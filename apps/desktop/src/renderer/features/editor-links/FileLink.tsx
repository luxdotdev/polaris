/**
 * Every `path:line` in the app as one action (spec §5): `FileLink` where the path isn't
 * clickable yet, `OpenInEditorButton` beside one whose click already does something else.
 * Both take the Host and root from the nearest `EditorPlaceProvider` unless given a `place`.
 */
import { cn, EditorIcon, IconButton } from "@polaris/ui";
import type { MouseEvent, ReactNode } from "react";
import type { EditorLocation } from "../../routes/editor.ts";
import { type EditorPlace, useEditorPlace } from "./place.ts";
import { useOpenInEditor } from "./useOpenInEditor.ts";

export interface FileTarget {
  readonly path: string;
  readonly line?: number | null;
  readonly column?: number | null;
  readonly place?: EditorPlace | null;
}

const locationOf = (target: FileTarget, context: EditorPlace | null): EditorLocation | null => {
  const place = target.place ?? context;

  if (place === null) return null;

  return {
    hostKey: place.hostKey,
    root: place.root,
    workspaceId: place.workspaceId ?? null,
    path: target.path,
    line: target.line ?? null,
    column: target.column ?? null,
  };
};

/** Opens `target` on click; null when no place is known (a fixture, a preview). */
const useOpenTarget = (target: FileTarget): ((event: MouseEvent) => void) | null => {
  const open = useOpenInEditor();
  const location = locationOf(target, useEditorPlace());

  if (location === null) return null;

  return (event) => {
    event.stopPropagation();
    open(location);
  };
};

export interface FileLinkProps extends FileTarget {
  /** What it shows; `path:line` by default. */
  readonly children?: ReactNode;
  readonly className?: string;
}

export const FileLink = ({ children, className, ...target }: FileLinkProps) => {
  const onClick = useOpenTarget(target);
  const label = children ?? (target.line ? `${target.path}:${target.line}` : target.path);

  if (onClick === null) return <span className={cn("min-w-0 truncate", className)}>{label}</span>;

  return (
    <button
      type="button"
      onClick={onClick}
      title="Open in editor"
      data-testid="file-link"
      className={cn(
        "hover:text-text-strong min-w-0 cursor-pointer truncate text-left underline-offset-2 hover:underline focus-visible:underline",
        className
      )}
    >
      {label}
    </button>
  );
};

export interface OpenInEditorButtonProps extends FileTarget {
  readonly className?: string;
}

/** A small icon button; it never triggers the row or header it sits in. */
export const OpenInEditorButton = ({ className, ...target }: OpenInEditorButtonProps) => {
  const onClick = useOpenTarget(target);

  if (onClick === null) return null;

  return (
    <IconButton
      size="sm"
      label="Open in editor"
      icon={<EditorIcon />}
      className={className}
      data-testid="open-in-editor"
      onClick={onClick}
    />
  );
};

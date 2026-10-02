/**
 * What the code area says when there's no text to show yet or at all:
 * opening (only after a beat, so a fast open never flashes), not text, gone,
 * or the Daemon's reason it couldn't be read.
 */
import { Button } from "@polaris/ui";
import { useEffect, useState } from "react";
import { baseName } from "../model/language.ts";
import type { BufferView } from "../runtime/store.ts";

/** A local open is done well before this; a remote one says it's working. */
const OPENING_DELAY_MS = 200;

export interface FileNoticeProps {
  readonly buffer: BufferView | null;
  readonly path: string;
  readonly onClose: () => void;
}

const size = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const useDelayed = (on: boolean) => {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!on) {
      setShown(false);

      return undefined;
    }

    const timer = setTimeout(() => setShown(true), OPENING_DELAY_MS);

    return () => clearTimeout(timer);
  }, [on]);

  return shown;
};

export const FileNotice = ({ buffer, path, onClose }: FileNoticeProps) => {
  const status = buffer?.status ?? { kind: "loading" as const };
  const opening = useDelayed(status.kind === "loading");
  const name = baseName(path);

  if (status.kind === "ready" || (status.kind === "loading" && !opening)) return null;

  const lines = {
    loading: { title: `Opening ${name}…`, fact: null },
    binary: {
      title: `${name} isn't text`,
      fact: status.kind === "binary" ? size(status.size) : null,
    },
    missing: { title: `${name} isn't on disk`, fact: "It was moved or deleted." },
    error: {
      title: `Couldn't open ${name}`,
      fact: status.kind === "error" ? status.message : null,
    },
  }[status.kind];

  return (
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <p className="text-body text-text-default">{lines.title}</p>
      {lines.fact === null ? null : <p className="text-caption text-text-subtle">{lines.fact}</p>}
      {status.kind === "loading" ? null : (
        <Button size="sm" onClick={onClose}>
          Close tab
        </Button>
      )}
    </div>
  );
};

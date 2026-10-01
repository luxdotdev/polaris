/**
 * Says when a Host's Daemon was upgraded (a toast), above all this Mac's,
 * which upgrades on its own when the app bundles a newer or dev build.
 * Upgrades already shown when it mounts stay quiet.
 */
import { PixelCheckIcon, showToast } from "@polaris/ui";
import { useEffect, useRef } from "react";
import { useMachines } from "./hooks.tsx";
import { upgradeNotes } from "./model.ts";

export const UpgradeToasts = () => {
  const machines = useMachines();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (machines === null) return;
    const notes = upgradeNotes(machines, seen.current ?? new Set());

    if (seen.current === null) {
      seen.current = new Set(notes.map((n) => n.key));

      return;
    }

    for (const note of notes) {
      seen.current.add(note.key);
      showToast({
        source: "starlight",
        icon: <PixelCheckIcon size={16} />,
        title: note.title,
        message: note.message,
      });
    }
  }, [machines]);

  return null;
};

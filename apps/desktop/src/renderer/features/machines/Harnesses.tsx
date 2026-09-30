/**
 * The Harnesses on one Host, under its row in Settings → Hosts: the same live
 * availability, words, glyphs and one action as Settings → Harnesses (Paper
 * S1), one row per Harness. Sign-in runs the Harness's own command in a
 * terminal on the Host; a missing or outdated one opens its setup guide.
 */
import { cn } from "@polaris/ui";
import { useState } from "react";
import type { MachineView } from "../../../shared/api.ts";
import { slots } from "../../app/slots.tsx";
import { harnessGroups } from "../settings/model/harnesses.ts";
import { Action, GLYPHS } from "../settings/ui/harnessRow.tsx";
import { useHostProbes } from "../settings/ui/hostProbes.ts";

export const Harnesses = ({ machine }: { readonly machine: MachineView }) => {
  const { hosts, refresh } = useHostProbes();
  // The Harness whose sign-in is running under its row.
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const host = hosts.find((h) => h.hostKey === machine.key);

  if (host === undefined) return null;

  const rows = harnessGroups([host]).flatMap((group) =>
    group.rows.map((row) => ({ kind: group.kind, name: group.name, row }))
  );

  return (
    <section aria-label="Harnesses" className="flex flex-col">
      <span className="text-caption text-text-subtle pb-1">Harnesses</span>
      {rows.map(({ kind, name, row }) => (
        <div key={kind} className="flex flex-col" data-testid={`harness-${kind}`}>
          <div className="flex h-10 items-center">
            <span className="text-label text-text-default w-[140px] shrink-0 truncate pr-3">
              {name}
            </span>
            <span className="text-caption text-text-subtle w-24 shrink-0 truncate font-mono">
              {row.version ?? "—"}
            </span>
            <span
              className={cn(
                "text-body flex min-w-0 flex-1 items-center gap-1.5",
                row.ready ? "text-text-subtle" : "text-text-default"
              )}
            >
              <span className="text-text-subtle flex w-3.5 shrink-0 justify-center">
                {GLYPHS[row.glyph]}
              </span>
              <span className="truncate">{row.text}</span>
              {row.note === null ? null : (
                <span className="text-caption text-text-subtle truncate">· {row.note}</span>
              )}
            </span>
            <span className="flex w-[170px] shrink-0 justify-end">
              {row.action === null ? null : (
                <Action action={row.action} onSignIn={() => setSigningIn(kind)} />
              )}
            </span>
          </div>
          {signingIn === kind && row.action?.kind === "sign-in" ? (
            <slots.HarnessTerminal
              hostKey={machine.key}
              argv={row.action.argv}
              onExit={() => refresh(machine.key)}
              onClose={() => setSigningIn(null)}
            />
          ) : null}
        </div>
      ))}
    </section>
  );
};

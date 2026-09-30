/**
 * The Harnesses on one Host (`harness.availability`), in neutral glyphs and
 * text (DESIGN.md, Settings · Harnesses). Sign-in runs the Harness's own
 * command in a terminal on the Host, under its row (the shell's HarnessTerminal
 * slot); a missing Harness links its setup docs. Polaris never installs one.
 */
import { Button } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { HarnessAvailabilityView, MachineView } from "../../../shared/api.ts";
import { slots } from "../../app/slots.tsx";
import { olderThanTestedNote } from "../harness/index.ts";
import { call } from "./hooks.tsx";

const STATUS_TEXT: Readonly<Record<HarnessAvailabilityView["status"], string>> = {
  ready: "Ready",
  "needs-sign-in": "Needs sign-in",
  outdated: "Needs a newer version",
  "not-installed": "Not installed",
  unknown: "Couldn't tell",
};

const Action = ({
  harness,
  onSignIn,
}: {
  readonly harness: HarnessAvailabilityView;
  readonly onSignIn: () => void;
}) => {
  if (harness.status === "needs-sign-in" && harness.signInArgv !== null) {
    return (
      <Button size="sm" onClick={onSignIn}>
        Sign in in terminal
      </Button>
    );
  }

  if (
    (harness.status === "not-installed" || harness.status === "outdated") &&
    harness.docsUrl !== null
  ) {
    return (
      <a
        href={harness.docsUrl}
        target="_blank"
        rel="noreferrer"
        className="text-caption text-text-default underline decoration-(--color-hairline) underline-offset-2"
      >
        Setup docs
      </a>
    );
  }

  return null;
};

export const Harnesses = ({ machine }: { readonly machine: MachineView }) => {
  const [harnesses, setHarnesses] = useState<
    ReadonlyArray<HarnessAvailabilityView> | null | "loading"
  >("loading");
  // The Harness whose sign-in is running under its row.

  const [signingIn, setSigningIn] = useState<string | null>(null);

  const load = (refresh: boolean) =>
    void call("machines.harnesses", { hostKey: machine.key, refresh }).then((found) =>
      setHarnesses(found)
    );

  useEffect(() => {
    void call("machines.harnesses", { hostKey: machine.key, refresh: false }).then(setHarnesses);
  }, [machine.key]);

  if (harnesses === null) return null;

  return (
    <section aria-label="Harnesses" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-caption text-text-subtle">Harnesses</span>
        <Button size="sm" variant="ghost" onClick={() => load(true)}>
          Check again
        </Button>
      </div>
      {harnesses === "loading" ? (
        <p className="text-caption text-text-faint">Checking…</p>
      ) : (
        <ul className="flex flex-col">
          {harnesses.map((harness) => (
            <li
              key={harness.harness}
              className="flex flex-col"
              data-testid={`harness-${harness.harness}`}
            >
              <div className="h-row flex items-center gap-3">
                <span className="text-label text-text-default w-[120px] shrink-0">
                  {harness.name}
                </span>
                <span className="text-code-inline text-text-subtle w-[84px] shrink-0 truncate font-mono">
                  {harness.version ?? "—"}
                </span>
                <span className="text-caption text-text-default flex min-w-0 flex-1 gap-1.5">
                  <span>{STATUS_TEXT[harness.status]}</span>
                  {olderThanTestedNote(harness.olderThanTested) === null ? null : (
                    <span className="text-text-subtle truncate">
                      · {olderThanTestedNote(harness.olderThanTested)}
                    </span>
                  )}
                </span>
                <Action harness={harness} onSignIn={() => setSigningIn(harness.harness)} />
              </div>
              {signingIn === harness.harness && harness.signInArgv !== null ? (
                <slots.HarnessTerminal
                  hostKey={machine.key}
                  argv={harness.signInArgv}
                  onExit={() => load(true)}
                  onClose={() => setSigningIn(null)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

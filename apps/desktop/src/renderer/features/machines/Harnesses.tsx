/**
 * The Harnesses on one Host (`harness.availability`), in neutral glyphs and
 * text (DESIGN.md, Settings · Harnesses). Sign-in opens the Harness's own
 * terminal; a missing Harness links its setup docs. Polaris never installs one.
 */
import { Button } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { HarnessAvailabilityView, MachineView } from "../../../shared/api.ts";
import { call } from "./hooks.tsx";

const STATUS_TEXT: Readonly<Record<HarnessAvailabilityView["status"], string>> = {
  ready: "Ready",
  "needs-sign-in": "Needs sign-in",
  outdated: "Needs a newer version",
  "not-installed": "Not installed",
  unknown: "Couldn't tell",
};

const Action = ({
  machine,
  harness,
}: {
  readonly machine: MachineView;
  readonly harness: HarnessAvailabilityView;
}) => {
  if (harness.status === "needs-sign-in" && harness.canSignIn) {
    return (
      <Button
        size="sm"
        onClick={() =>
          void call("machines.signIn", { hostKey: machine.key, harness: harness.harness })
        }
      >
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
              className="h-row flex items-center gap-3"
              data-testid={`harness-${harness.harness}`}
            >
              <span className="text-label text-text-default w-[120px] shrink-0">
                {harness.name}
              </span>
              <span className="text-code-inline text-text-subtle w-[84px] shrink-0 truncate font-mono">
                {harness.version ?? "—"}
              </span>
              <span className="text-caption text-text-default flex-1">
                {STATUS_TEXT[harness.status]}
              </span>
              <Action machine={machine} harness={harness} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

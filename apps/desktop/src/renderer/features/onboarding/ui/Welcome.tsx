/**
 * O1 Welcome (DESIGN.md, Onboarding; Paper 571-1 night, 5OY-1 dawn): the one
 * brand moment. The scene, the lockup, the tagline, "Get started", and what
 * was found on this Mac.
 */
import { HARNESS_CATALOGUE } from "@polaris/protocol";
import { Button, ButtonKeycap, Clearing, Scene } from "@polaris/ui";
import { type ReactNode, useEffect } from "react";
import { useOnboarding, useOnboardingState } from "../hooks.ts";
import { drivesLine, foundLine, installedNames } from "../model.ts";
import { useAvailability } from "./useAvailability.ts";

/** The local Host's key in the HostRegistry. */
const LOCAL_HOST = "local";

const CATALOGUE = HARNESS_CATALOGUE.map((h) => h.name);

const Note = ({ children }: { readonly children: ReactNode }) => (
  <p className="text-caption flex items-center gap-2 rounded-[8px] bg-(--onboarding-note) px-2.5 py-1.5">
    {children}
  </p>
);

export const Welcome = () => {
  const { getStarted } = useOnboarding();
  const sshHosts = useOnboardingState((s) => s.sshHosts);
  const version = useOnboardingState((s) => s.version);
  const availability = useAvailability(LOCAL_HOST);
  const installed = installedNames(availability);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented) return;
      event.preventDefault();
      getStarted();
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [getStarted]);

  return (
    <Scene
      data-testid="welcome"
      className="app-drag flex h-full flex-col items-center justify-center bg-(--scene-clearing)"
    >
      <Clearing
        bleed={40}
        className="-mt-20 flex flex-col items-center gap-7 px-[140px] pt-[72px] pb-16"
      >
        <h1 className="flex items-center gap-10" aria-label="Polaris">
          <span
            aria-hidden="true"
            className="pixelated size-36 shrink-0 bg-(image:--onboarding-star) bg-contain bg-center bg-no-repeat"
          />
          <span
            aria-hidden="true"
            className="font-pixel text-text-strong text-[144px] leading-[144px] tracking-[-0.01em]"
          >
            Polaris
          </span>
        </h1>
        <div className="flex flex-col items-center gap-2.5 text-center">
          <p className="text-display text-text-strong font-medium tracking-[-0.015em]">
            The north star for your agents.
          </p>
          <p className="text-heading-sm text-text-default font-regular">
            Launch, steer, and review {drivesLine(installed, CATALOGUE)} on this Mac and every host
            you reach over SSH.
          </p>
        </div>
        <Button
          variant="primary"
          size="brand"
          className="app-no-drag"
          data-testid="get-started"
          onClick={getStarted}
        >
          Get started <ButtonKeycap>↵</ButtonKeycap>
        </Button>
      </Clearing>
      <footer
        data-testid="found"
        className="absolute inset-x-8 bottom-7 flex items-center justify-between gap-4"
      >
        <Note>
          <span className="text-text-strong">Found on this Mac</span>
          <span className="text-text-default truncate">
            {foundLine(availability, sshHosts?.length ?? null)}
          </span>
        </Note>
        {version === null ? null : (
          <Note>
            <span className="text-text-default">Polaris {version}</span>
          </Note>
        )}
      </footer>
    </Scene>
  );
};

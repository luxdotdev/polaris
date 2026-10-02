/**
 * Settings → Constellations: what a new Constellation's workers start on, per role (spec §4,
 * precedence 3, after the Lead's `dispatch` and the Task's suggestion). Prefilled with the
 * spec's defaults; Reset returns a role to them.
 */
import { Button } from "@polaris/ui";
import type { RoleDefault } from "../../../../shared/contract.ts";
import { DEFAULT_SESSION_PREFS } from "../../../../shared/sessionPrefs.ts";
import { sectionInfo } from "../model/sections.ts";
import { sameChoice } from "../model/reviewer.ts";
import { syncLines } from "../model/constellationDefaults.ts";
import { useDefaultsSync } from "../defaultsSync.ts";
import { useApp } from "../../../shell/hooks.ts";
import { setSessionPrefs, useSettings } from "../store.ts";
import { Column, Group, Heading, PageHeader } from "./parts.tsx";
import { ReviewerChoice } from "./ReviewerChoice.tsx";
import { useModelHost } from "./ReviewerPage.tsx";

type Role = keyof typeof DEFAULT_SESSION_PREFS.constellationDefaults;

const ROLES: ReadonlyArray<{
  readonly role: Role;
  readonly title: string;
  readonly caption: string;
}> = [
  {
    role: "backend",
    title: "Backend and systems",
    caption: "Daemon, protocol, engine, tools and scripts.",
  },
  {
    role: "ui",
    title: "UI and design",
    caption: "The Desktop App, mockups, copy and anything a user sees.",
  },
];

const RoleRow = ({
  title,
  caption,
  value,
  fallback,
  onChange,
}: {
  readonly title: string;
  readonly caption: string;
  readonly value: RoleDefault;
  readonly fallback: RoleDefault;
  readonly onChange: (value: RoleDefault) => void;
}) => {
  const modelHost = useModelHost();

  return (
    <div className="px-panel flex flex-col gap-2.5 py-[calc(var(--spacing-gap)+6px)]">
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-label text-text-default">{title}</span>
          <span className="text-caption text-text-subtle">{caption}</span>
        </div>
        {sameChoice(value, fallback) ? null : (
          <Button variant="ghost" size="xs" onClick={() => onChange(fallback)}>
            Reset
          </Button>
        )}
      </div>
      <ReviewerChoice
        value={value}
        onChange={(choice) => {
          if (choice !== null) onChange(choice);
        }}
        modelHost={modelHost}
        allowAuto={false}
      />
    </div>
  );
};

/** Which Hosts hold the defaults: a lead uses its own Host's copy. */
const WhereSaved = () => {
  const sync = useDefaultsSync();
  const hosts = useApp((s) => s.hosts);

  const lines = syncLines(
    hosts.flatMap((h) => {
      const state = sync[h.key];

      return state === undefined || h.status.state !== "connected"
        ? []
        : [{ label: h.label, sync: state }];
    })
  );

  return lines.map((line) => (
    <p key={line} className="text-caption text-text-subtle" data-testid="defaults-sync">
      {line}
    </p>
  ));
};

export const ConstellationsPage = () => {
  const info = sectionInfo("constellations");
  const defaults = useSettings((s) => s.sessions.constellationDefaults);
  const fallback = DEFAULT_SESSION_PREFS.constellationDefaults;

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      <div className="flex flex-col gap-3" data-testid="constellation-defaults">
        <Heading aside={<span className="text-caption text-text-subtle">by the task's role</span>}>
          Workers start on
        </Heading>
        <Group label="Worker defaults">
          {ROLES.map(({ role, title, caption }) => (
            <RoleRow
              key={role}
              title={title}
              caption={caption}
              value={defaults[role]}
              fallback={fallback[role]}
              onChange={(value) =>
                setSessionPrefs({ constellationDefaults: { ...defaults, [role]: value } })
              }
            />
          ))}
        </Group>
        <WhereSaved />
        <p className="text-caption text-text-subtle">
          Workers use your harness permissions. Resources and how many workers a host runs at once
          are per host, in Hosts.
        </p>
      </div>
    </Column>
  );
};

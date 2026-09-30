/** The Settings nav (DESIGN.md, Settings): its groups, their sections, and each page's one line. */
import type { SettingsSection } from "../../../routes/selection.ts";

export interface SectionInfo {
  readonly id: SettingsSection;
  readonly title: string;
  /** The page's one `body` line: what it controls. */
  readonly blurb: string;
  /** Words the K menu matches on besides the title. */
  readonly keywords: ReadonlyArray<string>;
}

interface GroupSource {
  readonly title: string;
  readonly sections: ReadonlyArray<SectionInfo>;
}

const GROUPS: ReadonlyArray<GroupSource> = [
  {
    title: "General",
    sections: [
      {
        id: "appearance",
        title: "Appearance",
        blurb:
          "How Polaris looks on this Mac. These settings stay on this Mac; hosts don't share them.",
        keywords: [
          "theme",
          "dark",
          "light",
          "density",
          "text size",
          "font",
          "motion",
          "colourblind",
        ],
      },
    ],
  },
  {
    title: "Agents",
    sections: [
      {
        id: "harnesses",
        title: "Harnesses",
        blurb:
          "The agent programs Polaris drives on each host. Each harness keeps its own sign-in; Polaris never reads your keys or tokens.",
        keywords: ["claude", "codex", "opencode", "sign in", "model", "effort", "permissions"],
      },
      {
        id: "usage",
        title: "Usage",
        blurb:
          "Tokens from every harness on every host, read from each harness's own logs. Cost is an estimate unless the harness reports it.",
        keywords: ["tokens", "cost", "plan limits", "rate limit"],
      },
    ],
  },
  {
    title: "Machines",
    sections: [
      {
        id: "hosts",
        title: "Hosts",
        blurb: "The machines Polaris connects to over SSH.",
        keywords: ["machines", "ssh", "daemon", "add a host"],
      },
      {
        id: "attachments",
        title: "Attachments",
        blurb:
          "Pasted and dropped files are staged on the host that runs the session. Choose when each host deletes them.",
        keywords: ["files", "images", "staging", "cleanup", "clear", "disk"],
      },
    ],
  },
];

export interface SectionGroup {
  readonly title: string;
  readonly sections: ReadonlyArray<SettingsSection>;
}

export const SECTION_GROUPS: ReadonlyArray<SectionGroup> = GROUPS.map((g) => ({
  title: g.title,
  sections: g.sections.map((s) => s.id),
}));

export const SECTIONS: ReadonlyArray<SectionInfo> = GROUPS.flatMap((g) => g.sections);

const BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

export const sectionInfo = (id: SettingsSection): SectionInfo => {
  const found = BY_ID.get(id);

  if (found === undefined) throw new Error(`no settings section ${id}`);

  return found;
};

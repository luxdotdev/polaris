import {
  AttachmentSettings,
  AutoArchiveSettings,
  ConstellationSettings,
  DEFAULT_AUTO_ARCHIVE_DAYS,
  DEFAULT_IDLE_COMPACTION,
  DEFAULT_SUGGESTED_REPLY_SETTINGS,
  HostSessionDefault,
  HostSessionDefaults,
  KNOWN_HARNESS_KINDS,
  ReviewerSettings,
  SuggestedReplySettings,
  IdleCompactionSettings,
  VisualsSettings,
  WorkspaceTracesSettingsUpdate,
  describeSetting,
  setting,
} from "@polaris/protocol";
import { Schema } from "effect";

const nullable = <S extends Schema.Top>(schema: S) => Schema.NullOr(schema);

export const groups = {
  reviewer: {
    file: "reviewer-settings.json",
    schema: ReviewerSettings,
    defaults: ReviewerSettings.make({ default: null, workspaces: {} }),
    descriptions: {
      default: "The reviewer used on this host; null chooses an available harness automatically.",
      workspaces: "Reviewer choices that override the host default for each workspace.",
      onPullRequests: "Run the reviewer when a pull request opens in review.",
      onSessions:
        "Run the reviewer when an agent session opens in review or its turns are accepted.",
      askAboveLines: "Ask before reviewing more than this many changed lines; null never asks.",
      walkthrough: "Walkthrough harness, model and effort; null follows the reviewer.",
    },
  },
  constellation: {
    file: "constellation-settings.json",
    schema: ConstellationSettings,
    defaults: ConstellationSettings.make({}),
    descriptions: {
      branchPrefix:
        "Prefix for branches created for constellation tasks; null uses the built-in prefix.",
      transfer: "How work moves between hosts; null uses the built-in transfer method.",
      defaults: "Harness, model and effort used for constellation tasks without an override.",
      backend: "Harness, model and effort used for backend tasks.",
      ui: "Harness, model and effort used for interface tasks.",
      claimCoalescingMs: "Milliseconds to collect claim notifications before notifying the lead.",
      questionCoalescingMs: "Milliseconds to collect questions before notifying the lead.",
    },
  },
  attachments: {
    file: "attachment-settings.json",
    schema: AttachmentSettings,
    defaults: AttachmentSettings.make({ default: { kind: "on-archive" }, workspaces: {} }),
    descriptions: {
      default: "When this host removes staged attachments by default.",
      workspaces: "Attachment cleanup policies that override the host default for each workspace.",
    },
  },
  visuals: {
    file: "visuals-settings.json",
    schema: VisualsSettings,
    defaults: VisualsSettings.make({ level: "rich" }),
    descriptions: { level: "How readily agents on this host offer visualizations." },
  },
  "sessions.autoArchive": {
    file: "auto-archive-settings.json",
    schema: AutoArchiveSettings,
    defaults: AutoArchiveSettings.make({ afterDays: DEFAULT_AUTO_ARCHIVE_DAYS }),
    descriptions: {
      afterDays: "Days without activity before a dormant session is archived; null never archives.",
    },
  },
  "sessions.idleCompaction": {
    file: "idle-compaction-settings.json",
    schema: IdleCompactionSettings,
    defaults: DEFAULT_IDLE_COMPACTION,
    descriptions: {
      enabled: "Compact eligible idle sessions before their prompt cache expires.",
      minTokens: "Minimum context tokens required for idle compaction.",
    },
  },
  "sessions.suggestedReplies": {
    file: "suggested-replies.json",
    schema: SuggestedReplySettings,
    defaults: DEFAULT_SUGGESTED_REPLY_SETTINGS,
    descriptions: {
      enabled: "Offer suggested replies when a turn ends.",
      fallback: "Harness, model and effort for suggested replies; null picks an available harness.",
    },
  },
} as const;

export type Group = keyof typeof groups;

export const groupDefaults = (group: Group) =>
  Schema.decodeUnknownSync(Schema.JsonObject)(
    Schema.encodeSync(Schema.toCodecJson(groups[group].schema))(groups[group].defaults)
  );

const entries = Object.entries(groups).flatMap(([name, group]) => {
  // SAFETY: the name comes from Object.entries(groups).
  const key = name as Group;

  const descriptions = Schema.decodeUnknownSync(
    Schema.Record(Schema.String, Schema.NonEmptyString)
  )(group.descriptions);

  const defaults = groupDefaults(key);

  return Object.entries(group.schema.fields).map(
    ([field, schema]) =>
      [
        `${name}.${field}`,
        setting(defaults[field] === undefined ? nullable(schema) : schema, {
          description: Schema.decodeUnknownSync(Schema.NonEmptyString)(descriptions[field]),
          default: defaults[field] ?? null,
        }),
      ] as const
  );
});

const traceSchema = setting(Schema.Record(Schema.String, WorkspaceTracesSettingsUpdate), {
  description: "Trace collection, forwarding and instrumentation overrides for each workspace.",
  default: {},
});

export const registry: ReadonlyMap<string, Schema.Codec<unknown>> = new Map([
  ...entries,
  ["traces.workspaces", traceSchema],
  [
    "sessions.defaults",
    setting(HostSessionDefaults, {
      description: "Defaults for new agent sessions on this host, by harness.",
      default: {},
    }),
  ],
]);

const sessionFields = {
  model: setting(HostSessionDefault.fields.model, {
    description: "Model new agent sessions start with; null uses the harness default.",
    default: null,
  }),
  effort: setting(HostSessionDefault.fields.effort, {
    description: "Reasoning effort new agent sessions start with; null uses the harness default.",
    default: null,
  }),
  permissionMode: setting(HostSessionDefault.fields.permissionMode, {
    description: "Permission mode new agent sessions start with.",
    default: "supervised",
  }),
};

export const sessionSetting = (key: string): Schema.Codec<unknown> | undefined => {
  const match = /^sessions\.defaults\.[a-z][a-z0-9-]*\.(model|effort|permissionMode)$/.exec(key);

  return match === null
    ? undefined
    : sessionFields[
        Schema.decodeUnknownSync(Schema.Literals(["model", "effort", "permissionMode"]))(match[1])
      ];
};

export const schemaFor = (key: string) => registry.get(key) ?? sessionSetting(key);

export const settingKeys = (
  saved: Readonly<Record<string, Schema.Json>>
): ReadonlyArray<string> => [
  ...new Set([
    ...registry.keys(),
    ...KNOWN_HARNESS_KINDS.flatMap((harness) =>
      Object.keys(sessionFields).map((field) => `sessions.defaults.${harness}.${field}`)
    ),
    ...Object.keys(
      Schema.decodeUnknownSync(HostSessionDefaults)(saved["sessions.defaults"] ?? {})
    ).flatMap((harness) =>
      Object.keys(sessionFields).map((field) => `sessions.defaults.${harness}.${field}`)
    ),
  ]),
];

/** Used at startup and by the registry check; metadata must be present on every Schema. */
export const checkRegistry = () => {
  for (const key of settingKeys({})) describeSetting(key, schemaFor(key)!);
};

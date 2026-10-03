import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { HostView, LanguageApi } from "../../../../shared/api.ts";
import {
  LanguageSubscriptionItems,
  LanguageRequestInputs,
  LanguageRequestOutputs,
  type LanguageRequestMethod,
  type LanguageRequestInput,
  type LanguageRequestOutput,
} from "../../../../shared/languages.ts";
import { fixtureSnapshot, fixtureScopes } from "./fixture.ts";

const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  Schema.decodeUnknownSync(schema);

export const createIntegrationFixture = () => {
  const snapshot = fixtureSnapshot(P.LanguageSettingsScope.cases.App.make({}));
  const fact = snapshot.hosts[0];

  if (!fact || !fact.discovery) throw new Error("Missing fixture facts");

  const host: HostView = {
    key: "fake-0",
    label: fact.name,
    colour: null,
    alias: "fake-only",
    proofHarness: false,
    status: {
      state: "connected",
      failure: null,
      attempt: 0,
      since: 0,
      nextAttemptAt: null,
      host: P.HostInfo.make({
        hostId: fact.id,
        hostname: "fake-only",
        platform: "linux-x64",
        daemonVersion: "fake",
        homeDir: "/fixture",
        startedAt: new Date().toISOString(),
      }),
      capabilities: [
        "languages",
        "languages.install",
        "languages.trust",
        "languages.preview-media",
      ],
      epoch: 1,
      latencyMs: null,
      lastSeenAt: null,
    },
  };

  const records = new Map<string, typeof P.LanguageSettingsRecord.Type>();

  const availability = fact.tools[0]?.availability;

  if (!availability) throw new Error("Missing fake availability");

  const feeds: Array<{
    kind: string;
    stopped: boolean;
    emit: (items: ReadonlyArray<unknown>) => void;
    end: () => void;
  }> = [];

  const control = {
    availability,
    feeds,
    fail: false,
    foreign: false,
    foreignSave: false,
    foreignPolicy: false,
    foreignTrust: false,
    staleTrust: false,
    wrongTrustValue: false,
    hold: false,
    holdPolicyOnly: false,
    policyPending: false,
    policyCompletions: 0,
    releasePolicy: () => {},
    calls: new Array<string>(),
    release: () => {},
  };

  let policy = P.LanguagePreviewPolicy.make({
    ...P.LANGUAGE_EDITOR_DEFAULTS,
    hostId: fact.id,
    workspaceId: fact.discovery.checkout.workspaceId,
  });

  const catalog = P.LanguageCatalog.make({
    revision: 1,
    releaseDate: "fixture-only",
    tools: [],
    integrations: [
      {
        id: "python",
        languageIds: ["python"],
        patterns: ["*.py"],
        providers: [
          {
            id: "pyright",
            tool: "fixture-tool",
            role: "primary",
            diagnostics: "fixture",
            disableFeatures: [],
            entry: null,
            argv: [],
          },
        ],
        companions: [],
        formatter: {
          tool: "fixture-tool",
          source: "managed",
          mode: "lsp",
          detail: "Fixture formatter",
        },
        policy: {
          trust: "workspace-before-execution",
          network: "offline-only",
          configuration: "fixture",
        },
        limitations: [],
      },
    ],
  });

  const trustReply = (requested: LanguageRequestInput<"languages.trust.set">) => {
    return P.LanguageTrust.make({
      scope: control.foreignTrust
        ? { ...requested.scope, workspaceId: P.WorkspaceId.make("foreign") }
        : requested.scope,
      revision: requested.expectedRevision + (control.staleTrust ? 0 : 1),
      trusted: control.wrongTrustValue ? !requested.trusted : requested.trusted,
    });
  };

  const api: LanguageApi = {
    request: async <M extends LanguageRequestMethod>(method: M, raw: LanguageRequestInput<M>) => {
      control.calls.push(method);

      if (control.hold && (!control.holdPolicyOnly || method === "languages.preview.policy.set"))
        await new Promise<void>((resolve) => {
          if (control.holdPolicyOnly) {
            control.policyPending = true;
            control.releasePolicy = resolve;
          } else control.release = resolve;
        });

      if (control.fail)
        return { ok: false, error: { code: "Fixture", message: "Synthetic failure" } };
      let value;

      switch (method) {
        case "languages.settings.get": {
          const requested = Schema.decodeUnknownSync(
            LanguageRequestInputs["languages.settings.get"]
          )(raw);

          value =
            records.get(JSON.stringify(requested.scope)) ??
            P.LanguageSettingsRecord.make({ scope: requested.scope, revision: 0, settings: {} });

          if (control.foreign)
            value = P.LanguageSettingsRecord.make({
              scope: fixtureScopes[1]?.scope ?? requested.scope,
              revision: 0,
              settings: {},
            });
          break;
        }

        case "languages.settings.set": {
          const requested = Schema.decodeUnknownSync(
            LanguageRequestInputs["languages.settings.set"]
          )(raw);

          const old = records.get(JSON.stringify(requested.scope));

          if ((old?.revision ?? 0) !== requested.expectedRevision)
            return { ok: false, error: { code: "Conflict", message: "Fixture revision conflict" } };
          value = P.LanguageSettingsRecord.make({
            scope: requested.scope,
            revision: requested.expectedRevision + 1,
            settings: requested.settings,
          });
          records.set(JSON.stringify(requested.scope), value);

          if (control.foreignSave)
            value = P.LanguageSettingsRecord.make({
              scope: P.LanguageSettingsScope.cases.Language.make({ language: "go" }),
              revision: value.revision,
              settings: value.settings,
            });
          break;
        }

        case "languages.catalog":
          value = catalog;
          break;
        case "languages.availability":
          value = [control.availability];
          break;
        case "languages.discover":
          value = fact.discovery;
          break;
        case "languages.preview.policy.get":
          value = policy;
          break;
        case "languages.preview.policy.set": {
          const requested = Schema.decodeUnknownSync(
            LanguageRequestInputs["languages.preview.policy.set"]
          )(raw);

          policy = requested.policy;
          control.policyPending = false;
          control.policyCompletions++;
          value = control.foreignPolicy
            ? { ...policy, workspaceId: P.WorkspaceId.make("unrelated-workspace") }
            : policy;
          break;
        }

        case "languages.trust.set": {
          const requested = Schema.decodeUnknownSync(LanguageRequestInputs["languages.trust.set"])(
            raw
          );

          value = trustReply(requested);
          break;
        }

        default:
          throw new Error("Unexpected fixture request");
      }
      // SAFETY: the method's matching output schema validates every fake reply before returning it.

      const output = decode(LanguageRequestOutputs[method])(value) as LanguageRequestOutput<M>;

      return { ok: true, value: output };
    },
    subscribe: (kind, _input, listener) => {
      const feed = {
        kind,
        stopped: false,
        emit: (items: ReadonlyArray<unknown>) => {
          const decoded = Schema.decodeUnknownSync(Schema.Array(LanguageSubscriptionItems[kind]))(
            items
          );

          listener.items(decoded);
        },
        end: () => listener.end?.(null),
      };

      feeds.push(feed);

      return () => {
        feed.stopped = true;
      };
    },
  };

  return { api, host, control, records, discovery: fact.discovery };
};

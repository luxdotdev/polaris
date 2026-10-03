import * as P from "@polaris/protocol";
import { Predicate, Schema } from "effect";
import { LanguageSubscriptionItems } from "../../../../shared/languages.ts";
import type { LanguageHostView, LanguageSettingsSnapshot } from "./contracts.ts";
import type { LanguageIntegrationOptions } from "./integrationContracts.ts";

/** Stream facts never acknowledge Settings edits or infer executable readiness. */
export const watchLanguageFacts = (
  options: LanguageIntegrationOptions,
  initial: LanguageSettingsSnapshot,
  receive: (hosts: ReadonlyArray<LanguageHostView> | null) => void
) => {
  let active = true;
  let hosts = initial.hosts;
  const disposals: Array<() => void> = [];
  const jobs = new Map<string, () => void>();

  const stop = () => {
    active = false;
    disposals.splice(0).forEach((dispose) => dispose());
    jobs.forEach((dispose) => dispose());
    jobs.clear();
  };

  const ended = () => {
    if (!active) return;
    stop();
    receive(null);
  };

  const watchJob = (host: LanguageHostView, fact: P.LanguageAvailability) => {
    if (!options.api || !Predicate.isTagged(fact.installation, "Installing")) return;
    const installation = fact.installation;
    const key = `${host.key}:${fact.toolId}`;
    jobs.get(key)?.();
    let sequence = -1;
    let owned = true;

    const dispose = options.api.subscribe(
      "languages.install.watch",
      { hostKey: host.key, jobId: installation.jobId },
      {
        items: (items) => {
          if (!active || !owned) return;

          for (const item of items) {
            const progress = Schema.decodeUnknownSync(P.LanguageInstallProgress)(item);
            const owner = hosts.find((h) => h.key === host.key);
            const tool = owner?.tools.find((t) => t.availability.toolId === fact.toolId);

            if (
              !tool ||
              !Predicate.isTagged(tool.availability.installation, "Installing") ||
              tool.availability.installation.jobId !== installation.jobId ||
              progress.hostId !== host.id ||
              progress.toolId !== fact.toolId ||
              progress.jobId !== installation.jobId ||
              progress.version !== installation.version ||
              progress.sequence <= sequence
            )
              continue;
            sequence = progress.sequence;
            options.feedback?.progress(
              {
                hostId: host.id,
                hostName: host.name,
                languageName: options.language,
                toolId: fact.toolId,
              },
              progress
            );
            hosts = hosts.map((h) =>
              h.key !== host.key
                ? h
                : {
                    ...h,
                    tools: h.tools.map((t) => (t !== tool ? t : { ...t, progress })),
                  }
            );
            receive(hosts);
          }
        },
        end: ended,
      }
    );

    if (active)
      jobs.set(key, () => {
        owned = false;
        dispose();
      });
    else dispose();
  };

  for (const host of hosts) {
    const registered = options.hosts.find((h) => h.key === host.key);

    if (
      !active ||
      !options.api ||
      host.connection !== "Connected" ||
      host.capability !== "available" ||
      registered?.status.host?.hostId !== host.id
    )
      continue;
    const canInstall = registered.status.capabilities.includes("languages.install");

    if (canInstall) host.tools.forEach((t) => watchJob(host, t.availability));

    const dispose = options.api.subscribe(
      "languages.availability.watch",
      {
        hostKey: host.key,
        toolIds: host.tools.map((t) => t.availability.toolId),
        checkout: options.selected?.hostKey === host.key ? options.selected.checkout : null,
      },
      {
        items: (items) => {
          if (!active) return;

          for (const item of items) {
            const facts = Schema.decodeUnknownSync(
              LanguageSubscriptionItems["languages.availability.watch"]
            )(item);

            const owner = hosts.find((h) => h.key === host.key);

            if (
              !owner ||
              facts.some(
                (f) =>
                  f.hostId !== host.id ||
                  !owner.tools.some((t) => t.availability.toolId === f.toolId)
              )
            )
              continue;

            const updates = facts.filter(
              (f) =>
                f.checkedAt >
                (owner.tools.find((t) => t.availability.toolId === f.toolId)?.availability
                  .checkedAt ?? -1)
            );

            if (updates.length === 0) continue;
            hosts = hosts.map((h) =>
              h !== owner
                ? h
                : {
                    ...h,
                    tools: h.tools.map((t) => {
                      const availability = updates.find((f) => f.toolId === t.availability.toolId);

                      return availability
                        ? {
                            ...t,
                            availability,
                            progress: Schema.toEquivalence(P.LanguageInstallation)(
                              t.availability.installation,
                              availability.installation
                            )
                              ? t.progress
                              : null,
                            actions: canInstall
                              ? (options.permissions?.(host.key, availability) ?? {})
                              : {},
                          }
                        : t;
                    }),
                  }
            );

            for (const fact of updates) {
              const prior = owner.tools.find((t) => t.availability.toolId === fact.toolId);

              if (
                prior &&
                Schema.toEquivalence(P.LanguageInstallation)(
                  prior.availability.installation,
                  fact.installation
                )
              )
                continue;

              const key = `${host.key}:${fact.toolId}`;
              jobs.get(key)?.();
              jobs.delete(key);

              if (canInstall) watchJob(host, fact);
            }

            receive(hosts);
          }
        },
        end: ended,
      }
    );

    if (active) disposals.push(dispose);
    else dispose();
  }

  return stop;
};

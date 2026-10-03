import * as P from "@polaris/protocol";
import type {
  LanguageSettingsAdapter,
  LanguageSettingsResult,
  LanguageSettingsSnapshot,
} from "./contracts.ts";
import { fixtureSnapshot } from "./fixture.ts";

type Name = "first" | "replacement";

type SettingsRecord = typeof P.LanguageSettingsRecord.Type;

interface AuthorityControl {
  load: Record<Name, "ok" | "failed" | "wrong-scope" | "hold">;
  save: "ok" | "hold";
  aborted: number;
}

type Pending = { readonly key: string; readonly complete: () => void };

/** Deliberately ignores abort on held replies; deferred saves can still commit remotely. */
export const createAuthorityFixture = () => {
  const records = new Map<string, SettingsRecord>();
  const calls: Array<string> = [];
  const pending: Array<Pending> = [];

  const control: AuthorityControl = {
    load: { first: "ok", replacement: "ok" },
    save: "ok",
    aborted: 0,
  };

  const scope = P.LanguageSettingsScope.cases.App.make({});

  const read = (requested: P.LanguageSettingsScope) =>
    records.get(JSON.stringify(requested)) ??
    P.LanguageSettingsRecord.make({ scope: requested, revision: 0, settings: {} });

  const load = (
    name: Name,
    requested: P.LanguageSettingsScope
  ): LanguageSettingsResult<LanguageSettingsSnapshot> => {
    if (control.load[name] === "failed") return { ok: false, message: `${name} facts unavailable` };

    const target =
      control.load[name] === "wrong-scope"
        ? P.LanguageSettingsScope.cases.Language.make({ language: "python" })
        : requested;

    const record = read(target);
    const snapshot = fixtureSnapshot(target);

    return {
      ok: true,
      value: {
        ...snapshot,
        record,
        hosts: snapshot.hosts.map((host) => ({ ...host, name: `${name} · ${host.name}` })),
      },
    };
  };

  const commit = (record: SettingsRecord): LanguageSettingsResult<void> => {
    const previous = read(record.scope);

    if (previous.revision !== record.revision)
      return { ok: false, message: "Revision conflict: refresh facts; draft not applied." };
    records.set(
      JSON.stringify(record.scope),
      P.LanguageSettingsRecord.make({ ...record, revision: record.revision + 1 })
    );

    return { ok: true, value: undefined };
  };

  const held = <T>(key: string, signal: AbortSignal, complete: () => T) =>
    new Promise<T>((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          control.aborted += 1;
        },
        { once: true }
      );
      pending.push({ key, complete: () => resolve(complete()) });
    });

  const adapter = (name: Name): LanguageSettingsAdapter => ({
    load: async (requested, signal) => {
      calls.push(`load:${name}`);
      const result = load(name, requested);

      if (control.load[name] === "hold") return held(`load:${name}`, signal, () => result);

      return result;
    },
    save: async (record, signal) => {
      calls.push(`save:${name}:${record.revision}`);

      if (control.save === "hold") return held(`save:${name}`, signal, () => commit(record));

      return commit(record);
    },
    act: async (action) => {
      calls.push(`act:${name}:${action.kind}`);

      return { ok: true, value: undefined };
    },
  });

  return {
    adapters: { first: adapter("first"), replacement: adapter("replacement") },
    control,
    calls,
    complete: (key: string) => {
      const index = pending.findIndex((item) => item.key === key);

      if (index < 0) throw new Error(`No held fixture request ${key}`);
      const [item] = pending.splice(index, 1);
      item?.complete();
    },
    external: () => {
      const previous = read(scope);
      records.set(
        JSON.stringify(scope),
        P.LanguageSettingsRecord.make({
          ...previous,
          revision: previous.revision + 1,
          settings: { interpreter: "/fixture/other-writer" },
        })
      );
    },
    read: () => read(scope),
    pending: () => pending.map((item) => item.key),
  };
};

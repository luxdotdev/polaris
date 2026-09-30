/**
 * Renderer-side seeding for the screenshot script: registers Workspaces and
 * starts bench-Harness sessions through the app's own bridge, so every pixel
 * comes from real feeds. Returned as `page.evaluate` source.
 */
export type SeedState = "working" | "needs-you" | "idle";

export interface SeedSession {
  readonly title: string;
  readonly state: SeedState;
}

export interface SeedWorkspace {
  readonly hostKey: string;
  readonly name: string;
  readonly sessions: ReadonlyArray<SeedSession>;
}

const PROMPTS: Readonly<Record<SeedState, string>> = {
  working: `bench:${JSON.stringify({ items: 400, deltasPerItem: 20, deltaIntervalMs: 250 })}`,
  "needs-you": `bench:${JSON.stringify({ items: 3, approvalEvery: 1, deltasPerItem: 1, deltaIntervalMs: 1 })}`,
  idle: `bench:${JSON.stringify({ items: 1, deltasPerItem: 1, deltaIntervalMs: 1 })}`,
};

export const seedSource = (workspaces: ReadonlyArray<SeedWorkspace>) => `(async () => {
  const api = window.polaris;
  const plan = ${JSON.stringify(workspaces)};
  const prompts = ${JSON.stringify(PROMPTS)};
  const must = (result, what) => {
    if (!result.ok) throw new Error(what + ": " + result.error.code + " " + result.error.message);
    return result.value;
  };
  const id = () => crypto.randomUUID();
  const dispatch = (hostKey, command) =>
    api.request("dispatch", { hostKey, commandId: id(), command }).then((r) => must(r, command._tag));
  const workspaceAt = (hostKey, path) => new Promise((resolve) => {
    const close = api.subscribe("host", { hostKey }, { items: (items) => {
      for (const i of items) {
        const all = i._tag === "Snapshot" ? i.workspaces
          : i._tag === "Event" && i.envelope.event._tag === "WorkspaceRegistered" ? [i.envelope.event.workspace] : [];
        const found = all.find((w) => w.path === path);
        if (found) { close(); resolve(found.id); return; }
      }
    } });
  });
  for (const w of plan) {
    const { path } = must(await api.request("dev.proofWorkspace", {}), "dev.proofWorkspace");
    await dispatch(w.hostKey, { _tag: "RegisterWorkspace", path, name: w.name });
    const workspaceId = await workspaceAt(w.hostKey, path);
    for (const s of w.sessions) {
      const sessionId = id();
      await dispatch(w.hostKey, {
        _tag: "StartSession", sessionId, workspaceId, harness: s.harness ?? "claude",
        placement: { _tag: "InPlace" }, permissionMode: "auto", model: null, effort: null,
        prompt: prompts[s.state], attachments: [],
      });
      await dispatch(w.hostKey, { _tag: "RenameSession", sessionId, title: s.title });
    }
  }
  return plan.length;
})()`;

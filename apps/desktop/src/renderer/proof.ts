/**
 * The proof session: register a temporary Workspace on the dev Daemon and start
 * an Agent Session on the scripted bench Harness, all through `dispatch`, so the
 * screen shows the whole path working live. Dev only; spends no tokens.
 */
import type { SessionId, WorkspaceId } from "@polaris/protocol";
import type { Command } from "@polaris/protocol";
import type { PolarisApi } from "../shared/api.ts";
import { Commands, newCommandId, newSessionId, Placement } from "./commands.ts";
import type { AppStore } from "./store/store.ts";

/** A Turn that streams for about ten seconds: six items, forty deltas each. */
export const PROOF_PROMPT = `bench:${JSON.stringify({
  items: 6,
  deltasPerItem: 40,
  deltaBytes: 48,
  deltaIntervalMs: 40,
})}`;

const WAIT_MS = 10_000;

export class ProofFailed extends Error {
  readonly _tag = "ProofFailed";
}

const dispatch = async (api: PolarisApi, hostKey: string, command: Command) => {
  const result = await api.request("dispatch", { hostKey, commandId: newCommandId(), command });

  if (!result.ok) throw new ProofFailed(`${result.error.code}: ${result.error.message}`);
};

const workspaceAt = (store: AppStore, hostKey: string, path: string): Promise<WorkspaceId> =>
  new Promise((resolve, reject) => {
    const find = () =>
      [...(store.getState().hostModels[hostKey]?.workspaces.values() ?? [])].find(
        (w) => w.path === path
      )?.id;

    const found = find();

    if (found !== undefined) {
      resolve(found);

      return;
    }

    const timer = setTimeout(() => {
      stop();
      reject(new ProofFailed("the Workspace never showed up in the host feed"));
    }, WAIT_MS);

    const stop = store.subscribe(() => {
      const id = find();

      if (id === undefined) return;
      clearTimeout(timer);
      stop();
      resolve(id);
    });
  });

export interface ProofInput {
  readonly api: PolarisApi;
  readonly store: AppStore;
  readonly hostKey: string;
}

export const startProofSession = async ({
  api,
  store,
  hostKey,
}: ProofInput): Promise<SessionId> => {
  const dir = await api.request("dev.proofWorkspace", {});

  if (!dir.ok) throw new ProofFailed(dir.error.message);

  await dispatch(api, hostKey, Commands.RegisterWorkspace({ path: dir.value.path, name: "proof" }));
  const workspaceId = await workspaceAt(store, hostKey, dir.value.path);
  const sessionId = newSessionId();

  await dispatch(
    api,
    hostKey,
    Commands.StartSession({
      sessionId,
      workspaceId,
      harness: "claude",
      placement: Placement.InPlace(),
      permissionMode: "auto",
      model: null,
      effort: null,
      prompt: PROOF_PROMPT,
      attachments: [],
    })
  );

  await dispatch(api, hostKey, Commands.RenameSession({ sessionId, title: "Proof session" }));

  return sessionId;
};

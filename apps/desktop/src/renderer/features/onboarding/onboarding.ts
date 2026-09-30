/**
 * Onboarding's state for the renderer: whether the welcome shows, what was
 * found on this Mac, and the home fallback the shell's new-session actions use.
 */
import type { WorkspaceId } from "@polaris/protocol";
import { PixelFailedIcon, showToast } from "@polaris/ui";
import { createElement } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { PolarisApi } from "../../../shared/api.ts";
import type { AppStore } from "../../store/store.ts";
import { createEnsureWorkspace, type Ensured, type EnsureWorkspace } from "./ensureWorkspace.ts";
import type { Welcome } from "./model.ts";

export interface OnboardingState {
  readonly welcome: Welcome;
  /** The Host aliases in `~/.ssh/config`; null until read. */
  readonly sshHosts: ReadonlyArray<string> | null;
  readonly version: string | null;
}

export interface Onboarding {
  readonly store: StoreApi<OnboardingState>;
  /** "Get started": the welcome goes, and isn't shown again. */
  readonly getStarted: () => void;
  /** The Host's Workspace, or its home directory registered as one (see ensureWorkspace.ts). */
  readonly ensureWorkspace: EnsureWorkspace;
  /** The same, for the shell: a failure is toasted and resolves null. */
  readonly workspaceFor: (hostKey: string) => Promise<WorkspaceId | null>;
}

export interface OnboardingInput {
  readonly api: PolarisApi;
  readonly store: AppStore;
}

export const createOnboarding = ({ api, store }: OnboardingInput): Onboarding => {
  const state = createStore<OnboardingState>(() => ({
    welcome: "unknown",
    sshHosts: null,
    version: null,
  }));

  void api.request("settings.get", {}).then((result) => {
    // Unreadable settings show the welcome once more rather than never.
    state.setState({ welcome: result.ok && result.value.welcomeSeen ? "seen" : "show" });
  });

  void api.request("onboarding.found", {}).then((result) => {
    if (result.ok) state.setState(result.value);
  });

  const ensureWorkspace = createEnsureWorkspace({ api, store });

  return {
    store: state,
    getStarted: () => {
      state.setState({ welcome: "seen" });
      void api.request("onboarding.welcomeSeen", {});
    },
    ensureWorkspace,
    workspaceFor: async (hostKey) => {
      const ensured = await ensureWorkspace(hostKey);

      if (ensured.ok) return ensured.workspaceId;

      showToast({
        source: "starlight",
        icon: createElement(PixelFailedIcon, { size: 16 }),
        title: "Couldn't start a session",
        message: ensured.reason,
      });

      return null;
    },
  };
};

/** For fixtures (the session preview): the welcome already seen, nothing found, no fallback. */
export const settledOnboarding = (): Onboarding => {
  const unavailable = () =>
    Promise.resolve<Ensured>({ ok: false, reason: "not available in a preview" });

  return {
    store: createStore<OnboardingState>(() => ({ welcome: "seen", sshHosts: [], version: null })),
    getStarted: () => undefined,
    ensureWorkspace: unavailable,
    workspaceFor: () => Promise.resolve(null),
  };
};

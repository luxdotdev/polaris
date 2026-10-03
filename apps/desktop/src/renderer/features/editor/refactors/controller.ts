import type { LanguageTreeEditProposal } from "@polaris/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";
import { previewFingerprint, type DraftGroup } from "./group.ts";
import type { Preview, RefactorCoordinator } from "./coordinator.ts";
import { equal, sameRefactorOwner } from "./equality.ts";

export interface RefactorState {
  readonly hostKey: string;
  readonly preview: Preview | null;
  readonly group: DraftGroup | null;
  readonly busy: boolean;
  readonly error: string | null;
}

/** Server requests only offer; Accept is an explicit user command on the displayed preview. */
export class RefactorController {
  readonly state: StoreApi<RefactorState>;
  constructor(
    readonly hostKey: string,
    readonly coordinator: RefactorCoordinator
  ) {
    this.state = createStore<RefactorState>(() => ({
      hostKey,
      preview: null,
      group: null,
      busy: false,
      error: null,
    }));
  }

  async offer(proposal: LanguageTreeEditProposal) {
    const current = this.state.getState();

    if (current.preview !== null || current.busy)
      throw new Error("Finish the current refactor preview first.");
    this.state.setState({ busy: true, error: null });

    try {
      this.state.setState({ preview: await this.coordinator.preview(proposal), group: null });
    } catch (cause) {
      this.state.setState({ error: String(cause) });
      throw cause;
    } finally {
      this.state.setState({ busy: false });
    }
  }

  async applyAction(proposal: LanguageTreeEditProposal) {
    if (proposal.origin === "server-apply-edit") return this.offer(proposal);
    this.availablePreview();
    const preview = await this.coordinator.preview(proposal);
    this.availablePreview();
    const resources = proposal.edit.documentChanges?.some((change) => "kind" in change) ?? false;

    if (resources || preview.touched.length !== 1) return this.offer(proposal);

    return this.run(() =>
      this.coordinator.accept(preview, crypto.randomUUID(), crypto.randomUUID(), this.hostKey)
    );
  }

  private availablePreview() {
    const current = this.state.getState();

    if (current.preview !== null || current.busy)
      throw new Error("Finish the current refactor preview first.");
  }

  private async run(action: () => Promise<DraftGroup | null>) {
    if (this.state.getState().busy) return;
    this.state.setState({ busy: true, error: null });

    try {
      const group = await action();
      this.state.setState({ group, preview: null });
    } catch (cause) {
      this.state.setState({ error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      this.state.setState({ busy: false });
    }
  }

  accept() {
    const preview = this.state.getState().preview;

    if (preview === null) return Promise.resolve();

    return this.run(() =>
      this.coordinator.accept(preview, crypto.randomUUID(), crypto.randomUUID(), this.hostKey)
    );
  }

  reject() {
    const preview = this.state.getState().preview;

    if (preview === null) return Promise.resolve();

    return this.run(async () => {
      await this.coordinator.reject(preview, crypto.randomUUID());

      return null;
    });
  }

  status() {
    const group = this.state.getState().group;

    return group === null ? Promise.resolve() : this.run(() => this.coordinator.status(group.id));
  }

  recover(intent: "recover" | "undo" | "cancel") {
    const group = this.state.getState().group;

    return group === null
      ? Promise.resolve()
      : this.run(() => this.coordinator.recover(group.id, intent));
  }

  async restore() {
    this.state.setState({ group: null });
    const context = await this.coordinator.port.authority();

    const groups = (await this.coordinator.store.list()).filter(
      (group) =>
        group.hostKey === this.hostKey && sameRefactorOwner(group.proposal.fence.context, context)
    );

    if (!equal(context, await this.coordinator.port.authority()))
      throw new Error("Authenticated context changed while restoring recovery.");

    const verified = [];

    for (const group of groups) {
      if (group.fingerprint !== (await previewFingerprint(group.proposal))) continue;
      verified.push(group);
    }

    if (!equal(context, await this.coordinator.port.authority()))
      throw new Error("Authenticated context changed while restoring recovery.");

    verified.sort(
      (a, b) =>
        Number(a.state === "restored") - Number(b.state === "restored") || b.updatedAt - a.updatedAt
    );
    this.state.setState({ group: verified[0] ?? null });
  }
}

const controllers = new Map<string, RefactorController>();

const registry = createStore<{
  revision: number;
  controllers: ReadonlyMap<string, RefactorController>;
}>(() => ({ revision: 0, controllers: new Map() }));

export const refactorRegistry = registry;

export const refactorFor = (hostKey: string, root: string) =>
  controllers.get(hostKey + "\u0000" + root) ?? null;

/** G2/E1 supplies a fully authenticated coordinator; registration advertises no capability. */
export const bindRefactors = (controller: RefactorController, root: string) => {
  const key = controller.hostKey + "\u0000" + root;
  controllers.set(key, controller);
  registry.setState((state) => ({
    revision: state.revision + 1,
    controllers: new Map(controllers),
  }));

  return () => {
    if (controllers.get(key) !== controller) return;
    controllers.delete(key);
    registry.setState((state) => ({
      revision: state.revision + 1,
      controllers: new Map(controllers),
    }));
  };
};

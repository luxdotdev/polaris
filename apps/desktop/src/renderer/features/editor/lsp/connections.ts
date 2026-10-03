import * as P from "@polaris/protocol";
import { Option, Schema } from "effect";
import type { HostView } from "../../../../shared/api.ts";
import type { RendererLanguageConnection } from "./identity.ts";

export interface LanguageHostView {
  readonly key: string;
  readonly status: Pick<HostView["status"], "state" | "host" | "capabilities"> & {
    readonly languageConnectionEpoch?: number;
  };
}

export interface ProjectedLanguageConnection extends RendererLanguageConnection {
  readonly epoch: number;
}

interface Lifetime {
  readonly value: ProjectedLanguageConnection;
  readonly controller: AbortController;
}

const Epoch = P.LanguageCounter.check(Schema.isGreaterThan(0));

/** Main's optional epoch projects freshness only; independent identity still requires Main IPC. */
export class RendererLanguageConnections {
  private readonly lifetimes = new Map<string, Lifetime>();
  private disposed = false;

  constructor(readonly hosts: () => readonly LanguageHostView[]) {}

  readonly connection = (hostKey: string): ProjectedLanguageConnection | null => {
    const hosts = this.hosts().filter((host) => host.key === hostKey);
    const host = hosts.length === 1 ? hosts[0] : undefined;
    const epoch = Schema.decodeUnknownOption(Epoch)(host?.status.languageConnectionEpoch);
    const previous = this.lifetimes.get(hostKey);

    if (
      this.disposed ||
      host === undefined ||
      host.status.state !== "connected" ||
      host.status.host === null ||
      !host.status.capabilities.includes("languages") ||
      Option.isNone(epoch)
    ) {
      this.remove(hostKey);

      return null;
    }

    if (
      previous !== undefined &&
      previous.value.hostId === host.status.host.hostId &&
      previous.value.epoch === epoch.value
    )
      return previous.value;

    if (previous === undefined && this.lifetimes.size >= 128) return null;

    const controller = new AbortController();

    const value: ProjectedLanguageConnection = Object.freeze({
      token: {},
      hostId: host.status.host.hostId,
      epoch: epoch.value,
      signal: controller.signal,
      languages: true,
    });

    this.lifetimes.set(hostKey, { value, controller });
    previous?.controller.abort();

    return value;
  };

  refresh() {
    const keys = new Set(
      this.hosts()
        .slice(0, 128)
        .map((host) => host.key)
    );

    for (const key of this.lifetimes.keys()) if (!keys.has(key)) this.remove(key);

    for (const key of keys) this.connection(key);
  }

  keys(): readonly string[] {
    this.refresh();

    return [...this.lifetimes.keys()];
  }

  private remove(hostKey: string) {
    const previous = this.lifetimes.get(hostKey);
    this.lifetimes.delete(hostKey);
    previous?.controller.abort();
  }

  dispose() {
    this.disposed = true;

    for (const key of this.lifetimes.keys()) this.remove(key);
  }
}

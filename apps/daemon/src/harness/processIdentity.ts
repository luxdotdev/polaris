import type { Actor } from "../transport/actor.ts";
import { userActor } from "../transport/actor.ts";
import { processIdentity, type ProcessIdentity } from "./processTable.ts";

interface HarnessProcess {
  readonly actor: Actor;
  readonly started: string;
}

/** Registrations carry start time as well as PID, so PID reuse never inherits a Grant. */
export class HarnessProcesses {
  private readonly roots = new Map<number, HarnessProcess>();

  constructor(private readonly inspect: (pid: number) => ProcessIdentity = processIdentity) {}

  register(pid: number, actor: Actor): () => void {
    const entry = { actor, started: this.inspect(pid).started };
    this.roots.set(pid, entry);

    return () => {
      if (this.roots.get(pid) === entry) this.roots.delete(pid);
    };
  }

  /** One bounded walk per accepted socket. An unreadable or cyclic tree fails closed. */
  actorFor(pid: number): Actor {
    const visited = new Set<number>();

    while (pid > 1) {
      if (!Number.isInteger(pid) || visited.has(pid) || visited.size >= 1024)
        throw new Error("invalid process ancestry");
      visited.add(pid);
      const identity = this.inspect(pid);
      const root = this.roots.get(pid);

      if (root !== undefined && root.started === identity.started) return root.actor;
      pid = identity.parentPid;
    }

    return userActor;
  }
}

export const harnessProcesses = new HarnessProcesses();

import type { ProcessPort } from "../transport/index.ts";
import { failure } from "../transport/framing.ts";

/** Launch reservations include retiring processes until their cleanup completes. */
export class ProcessBudget {
  used = 0;
  reserve() {
    if (this.used >= 8) throw failure("queue-full", "Host language process limit reached");
    this.used++;
    let started = false;
    let released = false;

    const release = () => {
      if (released) return;
      released = true;
      this.used--;
    };

    return {
      spawn: (invoke: () => ProcessPort): ProcessPort => {
        const port = invoke();
        started = true;

        return { ...port, stop: (graceful) => port.stop(graceful).then(release) };
      },
      releaseUnstarted: () => {
        if (!started) release();
      },
    };
  }
}

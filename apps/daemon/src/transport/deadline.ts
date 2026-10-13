/**
 * Process-level deadlines for `polaris serve`. Startup must reach listening and a
 * stop signal must end the process, even while a fiber is parked in an
 * uninterruptible region that Effect's own interruption would wait on forever.
 * They use a plain unref'd timer, so they fire whatever the fibers are doing
 * and never keep an otherwise finished process alive.
 */

export interface Deadline {
  /** Records what the process is doing now; the expiry reports it. */
  readonly phase: (name: string) => void;
  /** Disarms the deadline. */
  readonly clear: () => void;
}

export interface DeadlineOptions {
  readonly ms: number;
  readonly onExpire: (phase: string, elapsedMs: number) => void;
}

export const deadline = (initial: string, options: DeadlineOptions): Deadline => {
  const started = performance.now();
  let current = initial;

  const timer = setTimeout(
    () => options.onExpire(current, Math.round(performance.now() - started)),
    options.ms
  );

  timer.unref();

  return {
    phase: (name) => {
      current = name;
    },
    clear: () => clearTimeout(timer),
  };
};

/** Startup deadline: generous for a large event store on a Raspberry Pi 4. */
export const STARTUP_DEADLINE_MS = 120_000;

/** Shutdown grace after SIGTERM / SIGINT, inside launchd's 20 s before SIGKILL. */
export const SHUTDOWN_GRACE_MS = 15_000;

/** Exit status when startup or shutdown missed its deadline (EX_SOFTWARE). */
export const SERVE_EXIT_STUCK = 70;

/** The expiry for `polaris serve`: say what it was stuck on, then exit non-zero. */
export const exitStuck =
  (what: string) =>
  (phase: string, elapsedMs: number): void => {
    process.stderr.write(
      `polaris serve: ${what} did not finish within ${Math.round(elapsedMs / 1000)} s; stuck ${phase}. Exiting.\n`
    );
    process.exit(SERVE_EXIT_STUCK);
  };

/** Arms the shutdown grace on the first SIGTERM / SIGINT; Effect's runtime still runs the graceful stop. */
export const armShutdownGrace = (ms = SHUTDOWN_GRACE_MS): void => {
  let armed = false;

  const arm = () => {
    if (armed) return;
    armed = true;
    deadline("shutting down", { ms, onExpire: exitStuck("shutdown") });
  };

  process.on("SIGTERM", arm);
  process.on("SIGINT", arm);
};

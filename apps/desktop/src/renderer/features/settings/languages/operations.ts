/** One foreground operation; aborted/obsolete replies cannot mutate the current view. */
export class SettingsOperations {
  private current: AbortController | null = null;

  async run<T>(
    work: (signal: AbortSignal) => Promise<T>,
    accept: (value: T) => void,
    fail: () => void
  ) {
    this.cancel();
    const controller = new AbortController();
    this.current = controller;

    try {
      const value = await work(controller.signal);

      if (this.current === controller && !controller.signal.aborted) accept(value);
    } catch {
      if (this.current === controller && !controller.signal.aborted) fail();
    } finally {
      if (this.current === controller) this.current = null;
    }
  }

  cancel() {
    this.current?.abort();
    this.current = null;
  }
}

/** What a Vite `?worker` import gives tests (see `test-preload.ts`): a Worker that can't start. */
export default class TestWorker {
  constructor() {
    throw new Error("No workers in tests: parse on the main thread");
  }
}

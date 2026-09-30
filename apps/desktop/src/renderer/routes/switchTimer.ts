/**
 * Measures a Workspace switch from the input event to the second animation
 * frame after it (about when that frame is presented), the way the ENG-184
 * spike did. M1 budget: under 100 ms. Readable as `window.__polaris.switchTimes()`.
 */

const KEEP = 200;

const samples: Array<number> = [];

/** `start` is the input event's `timeStamp` (same clock as `performance.now()`). */
export const timeSwitch = (start: number = performance.now()) => {
  requestAnimationFrame(() =>
    requestAnimationFrame((frame) => {
      samples.push(frame - start);

      if (samples.length > KEEP) samples.shift();
    })
  );
};

export const switchTimes = (): ReadonlyArray<number> => [...samples];

/** Exposed for the smoke test and benchmarks; read-only. */
export const exposeSwitchTimes = () => {
  window.__polaris = { switchTimes };
};

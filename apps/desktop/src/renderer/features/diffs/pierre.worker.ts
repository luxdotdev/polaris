/**
 * Pierre's worker as a plain import: its highlights chunk imports `worker.js` back, and as
 * Vite's `?worker` entry under dev that ran a second, uninitialized copy (ENG-972).
 */
import "@pierre/diffs/worker/worker.js";

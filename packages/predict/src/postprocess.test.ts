import { expect, test } from "bun:test";
import { postprocess } from "./postprocess.ts";
import { LatencyRecorder } from "./latency.ts";
import { request } from "./fixtures.testing.ts";

test("postprocess removes suffix overlap and stop markers while preserving indentation", () => {
  expect(postprocess("  return value;\n}", ";\n}", [], 8)).toBe("  return value");
  expect(postprocess("  return value<fim_middle>noise", "", ["<fim_middle>"], 8)).toBe(
    "  return value"
  );
  expect(postprocess("a\nb\nc", "", [], 2)).toBe("a\nb");
  expect(postprocess("\t \n", "", [], 8)).toBe("");
  expect(postprocess("abcab", "abc", [], 8)).toBe("abc");
  expect(postprocess("café 😀", "😀done", [], 8)).toBe("café ");
});

test("recorded spike Mellum output preserves the actual insertion", () => {
  // TABSPIKE c02 A, llama-mellum-full.jsonl (2026-10-13), raw model output.
  const raw = ".restart, b.log],\n    };\n  }";
  expect(postprocess(raw, "\n}", [], 8)).toBe(raw);
});

test("rolling p50 retains only 31 successes per endpoint and 32 endpoints", () => {
  const recorder = new LatencyRecorder();

  for (let sample = 0; sample < 40; sample++) recorder.record(request.endpoint, sample);
  expect(recorder.p50(request.endpoint)).toBe(24);
  recorder.record(request.endpoint, Number.NaN);
  recorder.record(request.endpoint, -1);
  expect(recorder.p50(request.endpoint)).toBe(24);

  for (let endpoint = 0; endpoint < 32; endpoint++)
    recorder.record({ kind: "openai", url: `http://localhost:${9000 + endpoint}` }, 1);
  expect(recorder.p50(request.endpoint)).toBeNull();
});

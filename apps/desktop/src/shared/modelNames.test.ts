import { expect, test } from "bun:test";
import { modelLabel } from "./modelNames.ts";

test.each([
  ["hf.co/mradermacher/Mellum2-12B-A2.5B-Base-GGUF:Q4_K_M", "Mellum2"],
  ["zeta-2.1-q4_k_m", "Zeta 2.1"],
  ["Zeta-2.1.Q4_K_M.gguf", "Zeta 2.1"],
  ["sweep-next-edit-1.5b-q8_0", "Sweep Next-Edit 1.5B"],
  ["qwen2.5-coder-1.5b:latest", "Qwen2.5-Coder"],
  ["hf.co/unsloth/Devstral-Small-2-GGUF:Q4_K_M", "Devstral-Small-2"],
  ["qwen3-coder-30b-a3b-Q4_K_M.gguf", "qwen3-coder-30b-a3b"],
  ["gemma3:12b", "gemma3"],
  ["plain-model", "plain-model"],
])("%s is shown as %s", (id, label) => {
  expect(modelLabel(id)).toBe(label);
});

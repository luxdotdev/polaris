/**
 * Short names for model ids the way servers report them: a repository prefix, a quantisation
 * suffix or an Ollama tag never belongs in a label (DESIGN.md, Tab completion status card).
 */

const KNOWN: ReadonlyArray<readonly [RegExp, string]> = [
  [/zeta[\W_]*2[._-]?1/i, "Zeta 2.1"],
  [/sweep.*next[\W_]*edit/i, "Sweep Next-Edit 1.5B"],
  [/mellum/i, "Mellum2"],
  [/qwen[\W_]*2[._-]?5[\W_]*coder/i, "Qwen2.5-Coder"],
];

/** "hf.co/org/Model-7B-GGUF:Q4_K_M" → "Model-7B"; known families get their product name. */
export const modelLabel = (id: string): string => {
  const known = KNOWN.find(([pattern]) => pattern.test(id));

  if (known !== undefined) return known[1];

  const bare = id
    .replace(/^(?:hf\.co|huggingface\.co)\/[^/]+\//i, "")
    .replace(/^[^/:]+\//, "")
    .replace(/:[^:]*$/, "")
    .replace(/\.gguf$/i, "")
    .replace(/[-_.](?:gguf|i1)$/i, "")
    .replace(/[-_.]?(?:i?q\d(?:_[a-z0-9]+)*|f16|f32|bf16)$/i, "")
    .replace(/[-_.]gguf$/i, "");

  return bare.length > 0 ? bare : id;
};

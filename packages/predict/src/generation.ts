/** Only block openers spend the multi-line budget; ordinary expressions stop at the newline. */
export const generationBudget = (prefix: string, maxTokens: number, maxLines: number) => {
  const trimmed = prefix.trimEnd();
  const line = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
  const block = /(?:\{|=>)$/.test(line) || (/^\s*\S.*:$/.test(line) && /\n[\t ]+$/.test(prefix));

  return block
    ? { maxTokens, maxLines, singleLine: false }
    : { maxTokens: Math.min(maxTokens, 32), maxLines: 1, singleLine: true };
};

/** Expose the first nonempty line through a stable boundary; Final may still retract overlap. */
export const provisionalLine = (text: string): string => {
  const first = text.search(/\S/);

  if (first < 0) return "";
  const newline = text.indexOf("\n", first);
  const line = newline < 0 ? text : text.slice(0, newline);
  const marker = line.indexOf("<");
  const clean = marker < 0 ? line : line.slice(0, marker);

  const boundary =
    newline >= 0 ? clean.length : (/[\s;,)}\]](?=[^\s;,)}\]]*$)/.exec(clean)?.index ?? -1) + 1;

  const result = clean.slice(0, boundary).replace(/\r$/, "");

  return result.trim() ? result : "";
};

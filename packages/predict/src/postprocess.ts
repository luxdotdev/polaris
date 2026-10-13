/** Longest generated tail matching the buffer suffix; linear even for repeated characters. */
const suffixOverlap = (text: string, suffix: string): number => {
  const pattern = suffix.slice(0, text.length);

  if (!pattern.length) return 0;
  const links = new Uint32Array(pattern.length);
  let matched = 0;

  for (let index = 1; index < pattern.length; index++) {
    while (matched > 0 && pattern[index] !== pattern[matched]) matched = links[matched - 1] ?? 0;

    if (pattern[index] === pattern[matched]) matched++;
    links[index] = matched;
  }

  matched = 0;

  for (let index = 0; index < text.length; index++) {
    while (matched > 0 && text[index] !== pattern[matched]) matched = links[matched - 1] ?? 0;

    if (text[index] === pattern[matched]) matched++;
  }

  return matched;
};

/** Removes only generated overlap, preserving indentation and the untouched buffer suffix. */
export const postprocess = (
  text: string,
  suffix: string,
  stop: readonly string[],
  maxLines: number
): string => {
  let end = text.length;

  for (const marker of stop) {
    const index = marker.length ? text.indexOf(marker) : -1;

    if (index >= 0) end = Math.min(end, index);
  }

  let result = text.slice(0, end);

  result = result.slice(0, result.length - suffixOverlap(result, suffix));

  result = result.split("\n").slice(0, Math.max(0, maxLines)).join("\n");

  return result.trim().length ? result : "";
};

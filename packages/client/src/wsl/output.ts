/**
 * What `wsl.exe` prints. Its own messages (distro lists, errors) are UTF-16LE
 * unless `WSL_UTF8=1` (WSL ≥ 0.64); a Linux program's stdio is relayed as the
 * raw bytes it wrote. Both can land on one stderr pipe, so chunks are sniffed:
 * see docs/adr/0034-wsl-hosts.md.
 */

/** The environment every `wsl.exe` spawn gets: UTF-8 output where WSL supports it. */
export const wslEnv = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({
  ...env,
  WSL_UTF8: "1",
});

/** True when `bytes` look like UTF-16LE text: even length and a NUL in most odd positions. */
export const looksUtf16le = (bytes: Uint8Array): boolean => {
  if (bytes.length < 2 || bytes.length % 2 !== 0) return false;
  let nulHigh = 0;

  for (let i = 1; i < bytes.length; i += 2) if (bytes[i] === 0) nulHigh++;

  return nulHigh * 2 >= bytes.length / 2;
};

/** Decodes one complete `wsl.exe` output (a BOM or NUL-interleaved bytes mean UTF-16LE). */
export const decodeWslOutput = (bytes: Uint8Array): string => {
  const bom = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;

  if (bom || looksUtf16le(bytes)) return new TextDecoder("utf-16le").decode(bytes);

  return new TextDecoder("utf-8").decode(bytes);
};

/**
 * A streaming decoder for stderr: each chunk is sniffed on its own, because
 * `wsl.exe` writes a failure as one UTF-16LE write while the Linux side
 * writes UTF-8. Partial code points carry over within one encoding.
 */
export const wslStderrDecoder = (): ((chunk: Uint8Array) => string) => {
  const utf8 = new TextDecoder("utf-8");
  const utf16 = new TextDecoder("utf-16le");

  return (chunk) =>
    looksUtf16le(chunk)
      ? utf16.decode(chunk, { stream: true })
      : utf8.decode(chunk, { stream: true });
};

/** Strips the NULs a UTF-16LE ASCII message leaves when it was read as UTF-8. */
export const stripUtf16Nuls = (text: string): string =>
  text.includes("\u0000") ? text.replaceAll("\u0000", "") : text;
